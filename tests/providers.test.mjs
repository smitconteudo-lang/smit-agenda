import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRoute,providerStatus} from '../src/providers.mjs';
import {unseal} from '../src/meta.mjs';

const base={SMIT_BASE_URL:'https://smit.example',SMIT_SUPABASE_URL:'https://db.example',SMIT_SUPABASE_SECRET_KEY:'sb_secret_TEST',SMIT_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),SMIT_GOOGLE_CLIENT_ID:'google-test',SMIT_GOOGLE_CLIENT_SECRET:'google-secret',SMIT_LINKEDIN_CLIENT_ID:'linkedin-test',SMIT_LINKEDIN_CLIENT_SECRET:'linkedin-secret',SMIT_LINKEDIN_API_VERSION:'209901',SMIT_LINKEDIN_SCOPES:'rw_organization_admin r_organization_social'};
test('a configuração depende do acesso a Páginas; login pessoal não habilita LinkedIn',()=>{
 assert.deepEqual(providerStatus(k=>base[k]),{meta:false,google:true,linkedin:true});
 assert.equal(providerStatus(k=>k==='SMIT_LINKEDIN_SCOPES'?'openid profile':base[k]).linkedin,false);
 assert.equal(providerStatus(k=>k==='SMIT_GOOGLE_CLIENT_SECRET'?'':base[k]).google,false);
});

for(const provider of ['google','linkedin'])test(provider+': autorização, seleção explícita, cifragem e renovação sem expor tokens',async()=>{
 const attempts=[],accounts=[],secrets=[],requests=[];let renewals=0,googleScope='https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
 const fetcher=async(target,options={})=>{
  const url=new URL(target);requests.push({url,options});const response=data=>Response.json(data);
  if(url.hostname==='db.example'){
   assert.equal(options.headers.apikey,base.SMIT_SUPABASE_SECRET_KEY);
   const table=url.pathname.split('/').pop(),data=options.body?JSON.parse(options.body):null,rows={smit_oauth_attempts:attempts,smit_accounts:accounts,smit_account_secrets:secrets}[table];assert.ok(rows);
   if(options.method==='POST'){const row=table==='smit_accounts'?{id:'00000000-0000-4000-8000-000000000001',...data}:table==='smit_oauth_attempts'?{status:'pending',...data}:data;rows.push(row);return response([row]);}
   const selected=rows.filter(row=>[...url.searchParams].every(([k,v])=>['select','order','limit'].includes(k)?true:v.startsWith('eq.')?String(row[k])===v.slice(3):v.startsWith('gt.')?Date.parse(row[k])>Date.parse(v.slice(3)):v.startsWith('lt.')?Date.parse(row[k])<Date.parse(v.slice(3)):v.startsWith('in.')?v.slice(4,-1).split(',').includes(row[k]):true));
   if(options.method==='PATCH')for(const row of selected)Object.assign(row,data);return response(selected.map(r=>({...r})));
  }
  if(url.hostname==='oauth2.googleapis.com'||url.pathname.endsWith('/accessToken')){const params=new URLSearchParams(options.body);assert.equal(params.get('client_secret'),base[provider==='google'?'SMIT_GOOGLE_CLIENT_SECRET':'SMIT_LINKEDIN_CLIENT_SECRET']);if(params.get('grant_type')==='refresh_token')renewals++;return response({access_token:'private-provider-token',refresh_token:'private-refresh-token',expires_in:3600,scope:provider==='google'?googleScope:base.SMIT_LINKEDIN_SCOPES});}
  if(url.hostname==='www.googleapis.com'){assert.equal(url.searchParams.get('mine'),'true');return response({items:[{id:'UCabcdefghijklmnopqrstuv',snippet:{title:'Canal de teste',customUrl:'@canal-teste'}}]});}
  if(url.pathname.endsWith('/organizationAcls')){assert.equal(options.headers['LinkedIn-Version'],'209901');return response({elements:[{role:'ADMINISTRATOR',state:'APPROVED',organization:'urn:li:organization:123'},{role:'ADMINISTRATOR',state:'REVOKED',organization:'urn:li:organization:666'},{role:'ANALYST',state:'APPROVED',organization:'urn:li:organization:777'}]});}
  if(url.pathname.endsWith('/organizations/123'))return response({id:123,localizedName:'Página de teste',vanityName:'pagina-teste'});
  throw Error('Unexpected '+url.pathname);
 };
 const invoke=(path,{method='GET',body={},query='',user='user-test'}={})=>providerRoute({req:{method},url:new URL('https://smit.example/api'+path+query),path,body,me:{id:user},env:k=>base[k],json:Response.json,fetcher});
 const prefix='/oauth/'+provider,start=await(await invoke(prefix+'/start',{method:'POST'})).json(),auth=new URL(start.url),state=auth.searchParams.get('state');
 assert.equal(auth.origin,provider==='google'?'https://accounts.google.com':'https://www.linkedin.com');assert.equal(auth.searchParams.get('redirect_uri'),'https://smit.example/api'+prefix+'/callback');assert.equal(state.length,43);assert.equal(auth.searchParams.has('client_secret'),false);
 if(provider==='google'){assert.equal(auth.searchParams.get('access_type'),'offline');assert.equal(auth.searchParams.get('include_granted_scopes'),'false');}
 const query='?code=one-use-code&state='+state;
 assert.match((await invoke(prefix+'/callback',{query,user:'wrong-user'})).headers.get('Location'),/failed/);assert.equal(attempts[0].status,'pending');
 assert.match((await invoke(prefix+'/callback',{query})).headers.get('Location'),/ready/);assert.equal(attempts[0].status,'ready');
 assert.match((await invoke(prefix+'/callback',{query})).headers.get('Location'),/failed/);
 const pending=await(await invoke('/oauth/pending')).json();assert.equal(pending[0].provider,provider);assert.equal(pending[0].assets.length,1);assert.ok(!JSON.stringify(pending).includes('private-'));
 await assert.rejects(()=>invoke(prefix+'/select',{method:'POST',body:{attempt_id:attempts[0].id,keys:['linkedin:666']}}),/não retornada/);
 const selection={attempt_id:attempts[0].id,keys:[pending[0].assets[0].key]};await invoke(prefix+'/select',{method:'POST',body:selection});
 assert.equal(accounts.length,1);assert.equal(accounts[0].publishing_enabled,false);assert.ok(accounts[0].verified_at);assert.equal(attempts[0].encrypted_payload,null);assert.equal(attempts[0].status,'connected');
 assert.equal(unseal(secrets[0].ciphertext,base.SMIT_TOKEN_ENCRYPTION_KEY,'account:'+accounts[0].id).refresh_token,'private-refresh-token');
 await assert.rejects(()=>invoke(prefix+'/select',{method:'POST',body:selection}),/expirada ou já utilizada/);
 const credentials=unseal(secrets[0].ciphertext,base.SMIT_TOKEN_ENCRYPTION_KEY,'account:'+accounts[0].id);credentials.expires_at='2000-01-01T00:00:00Z';const {seal}=await import('../src/meta.mjs');secrets[0].ciphertext=seal(credentials,base.SMIT_TOKEN_ENCRYPTION_KEY,'account:'+accounts[0].id);
 const verified=await(await invoke('/accounts/'+accounts[0].id+'/verify',{method:'POST'})).json();assert.equal(verified.verified,true);assert.equal(renewals,1);
 if(provider==='google'){
  googleScope='openid';const next=await(await invoke(prefix+'/start',{method:'POST'})).json();const otherState=new URL(next.url).searchParams.get('state');assert.match((await invoke(prefix+'/callback',{query:'?code=code&state='+otherState})).headers.get('Location'),/failed/);
 }
});
