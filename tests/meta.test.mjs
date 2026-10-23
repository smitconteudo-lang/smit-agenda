import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,metaRoute} from '../src/meta.mjs';

test('tokens cifrados recusam adulteração, outra conta e outra chave',()=>{
 const key='ab'.repeat(32),secret={token:'private-page-token'},value=seal(secret,key,'account:1');
 assert.ok(!value.includes(secret.token));assert.deepEqual(unseal(value,key,'account:1'),secret);
 assert.throws(()=>unseal(value,key,'account:2'));assert.throws(()=>unseal(value,'cd'.repeat(32),'account:1'));
 const parts=value.split('.');parts[2]=Buffer.alloc(16).toString('base64url');assert.throws(()=>unseal(parts.join('.'),key,'account:1'));
});

test('OAuth vincula estado ao usuário, impede repetição e só salva ativos selecionados',async()=>{
 const config={SMIT_BASE_URL:'https://smit.example',SMIT_SUPABASE_URL:'https://db.example',SMIT_SUPABASE_SECRET_KEY:'sb_secret_TEST',SMIT_META_APP_ID:'123',SMIT_META_APP_SECRET:'app-secret',SMIT_META_CONFIG_ID:'456',SMIT_META_API_VERSION:'v99.0',SMIT_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32)};
 const rows=[],accounts=[],secrets=[],seen=[];
 const fetcher=async(target,options={})=>{
  const url=new URL(target),body=options.body&&options.headers?.['Content-Type']==='application/json'?JSON.parse(options.body):null;seen.push({url,options});
  const response=data=>new Response(JSON.stringify(data),{status:200});
  if(url.hostname==='db.example'){
   assert.equal(options.headers.apikey,config.SMIT_SUPABASE_SECRET_KEY);
   const table=url.pathname.split('/').pop();
   if(table==='smit_oauth_attempts'){
    if(options.method==='POST'){rows.push({...body,status:'pending'});return response([rows.at(-1)]);}
    const matches=rows.filter(r=>[...url.searchParams].every(([k,v])=>k==='limit'||k==='order'||(v.startsWith('eq.')?String(r[k])===v.slice(3):v.startsWith('gt.')?Date.parse(r[k])>Date.parse(v.slice(3)):true)));
    if(options.method==='PATCH')for(const r of matches)Object.assign(r,body);
    return response(matches.map(r=>({...r})));
   }
   if(table==='smit_accounts'){if(options.method==='POST'){accounts.push({id:'00000000-0000-4000-8000-000000000001',...body});return response([accounts.at(-1)]);}if(options.method==='PATCH'){Object.assign(accounts[0],body);return response([accounts[0]]);}}
   if(table==='smit_account_secrets'){secrets.push(body);return response([body]);}
  }
  if(url.pathname.endsWith('/oauth/access_token'))return response({access_token:'user-secret-token'});
  if(url.pathname.endsWith('/debug_token'))return response({data:{is_valid:true,app_id:'123',expires_at:2000000000}});
  if(url.pathname.endsWith('/me/permissions'))return response({data:[{permission:'pages_show_list',status:'granted'}]});
  if(url.pathname.endsWith('/me/accounts'))return response({data:[{id:'101',name:'Página SMIT',access_token:'private-page-token',instagram_business_account:{id:'202',username:'smit_prefsp',name:'SMIT'}}]});
  if(url.pathname.endsWith('/202'))return response({id:'202',name:'SMIT',username:'smit_prefsp'});
  throw Error('Unexpected mock request '+url.pathname);
 };
 const invoke=(path,{method='GET',body={},query='',user='team-user'}={})=>metaRoute({req:{method},url:new URL('https://smit.example/api'+path+query),path,body,me:{id:user},env:k=>config[k],json:x=>Response.json(x),fetcher});
 const started=await (await invoke('/oauth/meta/start',{method:'POST'})).json(),auth=new URL(started.url),state=auth.searchParams.get('state');
 assert.equal(auth.origin,'https://www.facebook.com');assert.equal(auth.searchParams.get('config_id'),'456');assert.equal(auth.searchParams.get('redirect_uri'),'https://smit.example/api/oauth/meta/callback');assert.equal(state.length,43);assert.notEqual(rows[0].state_hash,state);
 const query='?state='+state+'&code=code-once';
 const wrong=await invoke('/oauth/meta/callback',{query,user:'another-user'});assert.match(wrong.headers.get('Location'),/failed/);assert.equal(rows[0].status,'pending');
 const completed=await invoke('/oauth/meta/callback',{query});assert.match(completed.headers.get('Location'),/ready/);assert.equal(rows[0].status,'ready');assert.ok(!rows[0].encrypted_payload.includes('private-page-token'));
 const replay=await invoke('/oauth/meta/callback',{query});assert.match(replay.headers.get('Location'),/failed/);
 const pending=await (await invoke('/oauth/pending')).json();assert.equal(pending[0].assets.length,2);assert.ok(!JSON.stringify(pending).includes('private-page-token'));assert.ok(!JSON.stringify(pending).includes('user-secret-token'));
 await assert.rejects(()=>invoke('/oauth/meta/select',{method:'POST',body:{attempt_id:rows[0].id,keys:['instagram:999']}}),/Conta não retornada/);
 await invoke('/oauth/meta/select',{method:'POST',body:{attempt_id:rows[0].id,keys:['instagram:202']}});
 assert.equal(accounts.length,1);assert.equal(accounts[0].channel,'instagram');assert.equal(accounts[0].publishing_enabled,false);assert.ok(accounts[0].verified_at);assert.equal(rows[0].status,'connected');assert.equal(rows[0].encrypted_payload,null);
 assert.deepEqual(unseal(secrets[0].ciphertext,config.SMIT_TOKEN_ENCRYPTION_KEY,'account:'+accounts[0].id),{token:'private-page-token'});
 await assert.rejects(()=>invoke('/oauth/meta/select',{method:'POST',body:{attempt_id:rows[0].id,keys:['instagram:202']}}),/expirou ou já foi/);
 assert.ok(seen.filter(x=>x.url.hostname==='graph.facebook.com'&&x.url.pathname.endsWith('/me/accounts')).every(x=>x.options.headers.Authorization==='Bearer user-secret-token'&&x.url.searchParams.has('appsecret_proof')));
});
