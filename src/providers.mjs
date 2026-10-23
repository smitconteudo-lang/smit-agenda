import {randomBytes} from 'node:crypto';
import {hashState,seal,unseal,publicAsset,configured as metaConfigured} from './meta.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const youtubeScope='https://www.googleapis.com/auth/youtube.readonly';
const analyticsScope='https://www.googleapis.com/auth/yt-analytics.readonly';
const linkedInScopes=new Set(['r_organization_admin','rw_organization_admin','r_organization_social','w_organization_social']);
export function providerStatus(env){
 const storage=['SMIT_SUPABASE_SECRET_KEY','SMIT_TOKEN_ENCRYPTION_KEY'].every(k=>!!env(k));
 const scopes=(env('SMIT_LINKEDIN_SCOPES')||'').split(/\s+/).filter(Boolean);
 return {meta:metaConfigured(env),google:storage&&!!env('SMIT_GOOGLE_CLIENT_ID')&&!!env('SMIT_GOOGLE_CLIENT_SECRET'),linkedin:storage&&['SMIT_LINKEDIN_CLIENT_ID','SMIT_LINKEDIN_CLIENT_SECRET','SMIT_LINKEDIN_API_VERSION'].every(k=>!!env(k))&&scopes.some(s=>['r_organization_admin','rw_organization_admin'].includes(s))&&scopes.every(s=>linkedInScopes.has(s))};
}

// Called only after the API has checked the live Supabase user, team and CSRF.
export async function providerRoute({req,url,path,body,me,env,json,fetcher=fetch}){
 const supa=env('SMIT_SUPABASE_URL'),secret=env('SMIT_SUPABASE_SECRET_KEY'),key=env('SMIT_TOKEN_ENCRYPTION_KEY'),base=env('SMIT_BASE_URL');
 if(!secret||!key)throw fail(503,'Conclua a configuração privada das integrações.');
 async function request(target,options={}){let response;try{response=await fetcher(target,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw fail(502,'O provedor não confirmou a resposta. Atualize antes de tentar novamente.');}const data=await response.json().catch(()=>null);if(!response.ok||data?.error)throw fail(response.status===401?409:502,'A conta não confirmou o acesso. Revise as permissões e reconecte se necessário.');return data;}
 async function db(route,method='GET',data,prefer='return=representation'){return request(supa+'/rest/v1/'+route,{method,headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json',Prefer:prefer},body:data===undefined?undefined:JSON.stringify(data)});}
 const expiresFilter='&expires_at=gt.'+encodeURIComponent(new Date().toISOString());
 const own='user_id=eq.'+encodeURIComponent(me.id);
 const redirect=result=>new Response(null,{status:303,headers:{Location:base+'/?connection='+result+'#accounts','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 const configs={google:{client:env('SMIT_GOOGLE_CLIENT_ID'),secret:env('SMIT_GOOGLE_CLIENT_SECRET'),auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scopes:[youtubeScope,analyticsScope]},linkedin:{client:env('SMIT_LINKEDIN_CLIENT_ID'),secret:env('SMIT_LINKEDIN_CLIENT_SECRET'),auth:'https://www.linkedin.com/oauth/v2/authorization',token:'https://www.linkedin.com/oauth/v2/accessToken',scopes:(env('SMIT_LINKEDIN_SCOPES')||'').split(/\s+/).filter(Boolean)}};
 async function exchange(provider,params){const c=configs[provider];return request(c.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client,client_secret:c.secret,...params}).toString()});}
 function authHeaders(provider,token){return {Authorization:'Bearer '+token,...(provider==='linkedin'?{'LinkedIn-Version':env('SMIT_LINKEDIN_API_VERSION'),'X-Restli-Protocol-Version':'2.0.0'}:{})};}
 async function assetsFor(provider,token,granted){
  if(provider==='google'){
   if(!granted.includes(youtubeScope))throw fail(403,'O Google não autorizou a leitura do canal.');
   let pageToken,assets=[];
   for(let page=0;page<10;page++){
    const params=new URLSearchParams({part:'id,snippet',mine:'true',maxResults:'50',...(pageToken?{pageToken}:{})});
    const result=await request('https://www.googleapis.com/youtube/v3/channels?'+params,{headers:authHeaders(provider,token)});
    for(const c of result.items||[])if(/^UC[\w-]{22}$/.test(c.id||''))assets.push({key:'youtube:'+c.id,channel:'youtube',remote_id:c.id,name:String(c.snippet?.title||c.id),handle:c.snippet?.customUrl||null});
    pageToken=result.nextPageToken;if(!pageToken)return assets;if(page===9)throw fail(502,'A listagem de canais ficou incompleta.');
   }
  }
  if(!granted.some(s=>['r_organization_admin','rw_organization_admin'].includes(s)))throw fail(403,'O aplicativo precisa de acesso administrativo às Páginas. Login pessoal não conecta a página da SMIT.');
  const headers=authHeaders(provider,token),ids=new Set();
  for(let start=0;start<1000;start+=100){
   const result=await request('https://api.linkedin.com/rest/organizationAcls?'+new URLSearchParams({q:'roleAssignee',state:'APPROVED',count:'100',start:String(start)}),{headers});
   for(const row of result.elements||[]){const urn=row.organization||row.organizationTarget;if(row.state==='APPROVED'&&['ADMINISTRATOR','CONTENT_ADMINISTRATOR'].includes(row.role)&&/^urn:li:organization:\d+$/.test(urn||''))ids.add(urn);}
   if((result.elements||[]).length<100)break;if(start===900)throw fail(502,'A listagem de Páginas ficou incompleta.');
  }
  if(ids.size>20)throw fail(400,'Autorize no máximo 20 Páginas por conexão.');
  const assets=[];for(const urn of ids){const id=urn.split(':').pop(),org=await request('https://api.linkedin.com/rest/organizations/'+id,{headers});if(String(org.id)!==id)throw fail(502,'A identidade da Página não confere.');assets.push({key:'linkedin:'+id,channel:'linkedin',remote_id:id,name:String(org.localizedName||org.vanityName||id),handle:org.vanityName||null});}return assets;
 }
 if(path==='/oauth/pending'&&req.method==='GET'){
  const rows=await db('smit_oauth_attempts?'+own+'&status=eq.ready'+expiresFilter+'&order=created_at.desc&limit=10');
  return json(rows.filter(r=>['meta','google','linkedin'].includes(r.provider)).map(r=>({id:r.id,provider:r.provider,assets:unseal(r.encrypted_payload,key,'attempt:'+r.id).assets.map(publicAsset)})));
 }
 const route=path.match(/^\/oauth\/(google|linkedin)\/(start|callback|select)$/);
 if(route){
  const [,provider,action]=route;if(!providerStatus(env)[provider])throw fail(503,provider==='google'?'Configure o cliente OAuth do Google no servidor.':'Configure o aplicativo LinkedIn com acesso aprovado às Páginas.');
  if(provider==='linkedin'&&!/^\d{6}$/.test(env('SMIT_LINKEDIN_API_VERSION')||''))throw fail(503,'Confira a versão da API LinkedIn.');
  const c=configs[provider],callback=base+'/api/oauth/'+provider+'/callback',filter=own+'&provider=eq.'+provider;
  if(action==='start'&&req.method==='POST'){
   await db('smit_oauth_attempts?'+filter+'&status=in.(pending,ready)&expires_at=lt.'+encodeURIComponent(new Date().toISOString()),'PATCH',{status:'expired',encrypted_payload:null});
   const state=randomBytes(32).toString('base64url'),id=crypto.randomUUID();
   await db('smit_oauth_attempts','POST',{id,user_id:me.id,state_hash:hashState(state),provider,expires_at:new Date(Date.now()+15*60000).toISOString()});
   const auth=new URL(c.auth);const params={client_id:c.client,redirect_uri:callback,response_type:'code',state,scope:c.scopes.join(' '),...(provider==='google'?{access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false'}:{})};for(const [k,v]of Object.entries(params))auth.searchParams.set(k,v);return json({url:auth.href});
  }
  if(action==='callback'&&req.method==='GET'){
   const state=url.searchParams.get('state');if(!/^[\w-]{43}$/.test(state||''))return redirect('failed');
   const claimed=await db('smit_oauth_attempts?'+filter+'&state_hash=eq.'+hashState(state)+'&status=eq.pending'+expiresFilter,'PATCH',{status:'processing'});if(claimed.length!==1)return redirect('failed');const attempt=claimed[0];
   try{
    if(url.searchParams.has('error')){await db('smit_oauth_attempts?id=eq.'+attempt.id+'&'+filter,'PATCH',{status:'cancelled',encrypted_payload:null});return redirect('cancelled');}
    const code=url.searchParams.get('code');if(!code||code.length>4096)throw fail(400,'Autorização incompleta.');
    const tokens=await exchange(provider,{grant_type:'authorization_code',code,redirect_uri:callback});if(!tokens.access_token||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw fail(502,'Credencial incompleta.');
    // Google returns actual granted scopes; don't infer analytics permission.
    if(provider==='google'&&(!tokens.refresh_token||!tokens.scope))throw fail(409,'Reconecte autorizando o acesso contínuo ao canal.');
    const scopes=(tokens.scope||c.scopes.join(' ')).split(/\s+/).filter(Boolean),assets=await assetsFor(provider,tokens.access_token,scopes);
    const credentials={token:tokens.access_token,refresh_token:tokens.refresh_token||null,scopes,expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString()};
    await db('smit_oauth_attempts?id=eq.'+attempt.id+'&'+filter+'&status=eq.processing','PATCH',{status:'ready',encrypted_payload:seal({assets,credentials},key,'attempt:'+attempt.id)});return redirect('ready');
   }catch{await db('smit_oauth_attempts?id=eq.'+attempt.id+'&'+filter,'PATCH',{status:'error',encrypted_payload:null});return redirect('failed');}
  }
  if(action==='select'&&req.method==='POST'){
   if(!/^[0-9a-f-]{36}$/i.test(body.attempt_id)||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>20||body.keys.some(k=>typeof k!=='string'))throw fail(400,'Selecione as contas retornadas pelo provedor.');
   const where='smit_oauth_attempts?id=eq.'+body.attempt_id+'&'+filter+'&status=eq.ready'+expiresFilter,rows=await db(where);if(rows.length!==1)throw fail(409,'Autorização expirada ou já utilizada.');
   const payload=unseal(rows[0].encrypted_payload,key,'attempt:'+rows[0].id),assets=[...new Set(body.keys)].map(k=>payload.assets.find(a=>a.key===k));if(assets.some(a=>!a))throw fail(400,'Conta não retornada nesta autorização.');
   const current=await assetsFor(provider,payload.credentials.token,payload.credentials.scopes);if(assets.some(a=>!current.some(b=>b.key===a.key)))throw fail(409,'O acesso às contas mudou. Reconecte.');
   const claim=await db(where,'PATCH',{status:'processing'});if(claim.length!==1)throw fail(409,'Autorização já em uso.');
   try{
    for(const asset of assets){const accounts=await db('smit_accounts?on_conflict=channel,remote_id','POST',{channel:asset.channel,remote_id:asset.remote_id,name:asset.name,handle:asset.handle,scopes:payload.credentials.scopes,verified_at:null,publishing_enabled:false,metadata:{provider}},'resolution=merge-duplicates,return=representation');const id=accounts[0].id;await db('smit_account_secrets?on_conflict=account_id','POST',{account_id:id,ciphertext:seal(payload.credentials,key,'account:'+id),expires_at:payload.credentials.expires_at,updated_at:new Date().toISOString()},'resolution=merge-duplicates,return=representation');await db('smit_accounts?id=eq.'+id,'PATCH',{verified_at:new Date().toISOString()});}
    await db('smit_oauth_attempts?id=eq.'+rows[0].id+'&'+filter,'PATCH',{status:'connected',encrypted_payload:null});return json({connected:assets.length,publishing_enabled:false});
   }catch(e){await db('smit_oauth_attempts?id=eq.'+rows[0].id+'&'+filter,'PATCH',{status:'error',encrypted_payload:null});throw e;}
  }
 }
 const verify=path.match(/^\/accounts\/([0-9a-f-]{36})\/verify$/i);
 if(verify&&req.method==='POST'){
  const accounts=await db('smit_accounts?id=eq.'+verify[1]+'&select=id,channel,remote_id');if(accounts.length!==1)throw fail(404,'Conta não encontrada.');const account=accounts[0],provider={youtube:'google',linkedin:'linkedin'}[account.channel];if(!provider||!providerStatus(env)[provider])throw fail(503,'Configure o provedor desta conta.');
  const rows=await db('smit_account_secrets?account_id=eq.'+account.id);if(rows.length!==1)throw fail(409,'Reconecte a conta.');let credentials=unseal(rows[0].ciphertext,key,'account:'+account.id);
  if(Date.parse(credentials.expires_at)<=Date.now()+60000){if(!credentials.refresh_token)throw fail(409,'O acesso expirou. Reconecte a conta.');const tokens=await exchange(provider,{grant_type:'refresh_token',refresh_token:credentials.refresh_token});if(!tokens.access_token||!Number.isFinite(tokens.expires_in))throw fail(409,'Reconecte a conta.');credentials={...credentials,token:tokens.access_token,refresh_token:tokens.refresh_token||credentials.refresh_token,expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString()};await db('smit_account_secrets?account_id=eq.'+account.id,'PATCH',{ciphertext:seal(credentials,key,'account:'+account.id),expires_at:credentials.expires_at,updated_at:new Date().toISOString()});}
  const assets=await assetsFor(provider,credentials.token,credentials.scopes);if(!assets.some(a=>a.remote_id===account.remote_id))throw fail(409,'O provedor não confirmou esta conta. Reconecte.');await db('smit_accounts?id=eq.'+account.id,'PATCH',{verified_at:new Date().toISOString()});return json({verified:true});
 }
 throw fail(404,'Operação de conexão não disponível.');
}
