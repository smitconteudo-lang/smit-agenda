import {createHash,createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export const hashState=s=>createHash('sha256').update(s).digest('hex');
function vaultKey(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw fail(503,'Configure a chave de proteção das contas no servidor.');return Buffer.from(value,'hex');}
export function seal(value,key,aad){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',vaultKey(key),iv);cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');}
export function unseal(value,key,aad){const [v,iv,tag,data,...rest]=value.split('.');if(v!=='v1'||!iv||!tag||!data||rest.length)throw fail(502,'Credencial armazenada inválida. Reconecte a conta.');const cipher=createDecipheriv('aes-256-gcm',vaultKey(key),Buffer.from(iv,'base64url'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8'));}
export const publicAsset=a=>({key:a.key,channel:a.channel,remote_id:a.remote_id,name:a.name,handle:a.handle});
export function configured(env){return ['SMIT_META_APP_ID','SMIT_META_CONFIG_ID','SMIT_META_APP_SECRET','SMIT_META_API_VERSION','SMIT_TOKEN_ENCRYPTION_KEY','SMIT_SUPABASE_SECRET_KEY'].every(k=>!!env(k));}

// All privileged calls stay in the function, after the main handler validates
// the Supabase user and team email. Tokens never appear in public responses.
export async function metaRoute({req,url,path,body,me,env,json,fetcher=fetch}){
 if(!configured(env))throw fail(503,'A conexão Meta está sendo configurada. Nenhuma conta foi autorizada ainda.');
 const base=env('SMIT_BASE_URL'),supa=env('SMIT_SUPABASE_URL'),secret=env('SMIT_SUPABASE_SECRET_KEY'),app=env('SMIT_META_APP_ID'),appSecret=env('SMIT_META_APP_SECRET'),version=env('SMIT_META_API_VERSION'),key=env('SMIT_TOKEN_ENCRYPTION_KEY');
 vaultKey(key);if(!/^v\d+\.0$/.test(version))throw fail(503,'Confira a versão da API Meta no servidor.');
 const callback=base+'/api/oauth/meta/callback';
 async function request(target,options={}){let response;try{response=await fetcher(target,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw fail(502,'O provedor não confirmou a resposta. Confira a conexão antes de repetir.');}const data=await response.json().catch(()=>null);if(!response.ok||data?.error)throw fail(502,'A conexão não foi confirmada pelo provedor. Confira as permissões do aplicativo e reconecte.');return data;}
 async function admin(route,method='GET',data,prefer='return=representation'){return request(supa+'/rest/v1/'+route,{method,headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json',Prefer:prefer},body:data===undefined?undefined:JSON.stringify(data)});}
 const own='user_id=eq.'+encodeURIComponent(me.id)+'&provider=eq.meta';
 async function graph(route,token,params={}){const u=new URL('https://graph.facebook.com/'+version+'/'+route);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));u.searchParams.set('appsecret_proof',createHmac('sha256',appSecret).update(token).digest('hex'));return request(u,{headers:{Authorization:'Bearer '+token}});}
 async function exchange(params){return request('https://graph.facebook.com/'+version+'/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:app,client_secret:appSecret,...params}).toString()});}
 const redirect=result=>new Response(null,{status:303,headers:{Location:base+'/?connection='+result+'#accounts','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 if(path==='/oauth/meta/start'&&req.method==='POST'){
  await admin('smit_oauth_attempts?'+own+'&status=in.(pending,ready)&expires_at=lt.'+encodeURIComponent(new Date().toISOString()),'PATCH',{status:'expired',encrypted_payload:null});
  const state=randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  await admin('smit_oauth_attempts','POST',{id,user_id:me.id,state_hash:hashState(state),provider:'meta',expires_at:new Date(Date.now()+15*60000).toISOString()});
  const auth=new URL('https://www.facebook.com/'+version+'/dialog/oauth');for(const [k,v] of Object.entries({client_id:app,config_id:env('SMIT_META_CONFIG_ID'),redirect_uri:callback,response_type:'code',state}))auth.searchParams.set(k,v);
  return json({url:auth.href});
 }
 if(path==='/oauth/meta/callback'&&req.method==='GET'){
  const state=url.searchParams.get('state');if(!/^[\w-]{43}$/.test(state||''))return redirect('failed');
  // Compare and claim the one-use state atomically, constrained to this user.
  const claimed=await admin('smit_oauth_attempts?'+own+'&state_hash=eq.'+hashState(state)+'&status=eq.pending&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),'PATCH',{status:'processing'});
  if(claimed.length!==1)return redirect('failed');const attempt=claimed[0];
  try{
   if(url.searchParams.has('error')){await admin('smit_oauth_attempts?id=eq.'+attempt.id+'&'+own,'PATCH',{status:'cancelled',encrypted_payload:null});return redirect('cancelled');}
   const code=url.searchParams.get('code');if(!code||code.length>4096)throw fail(400,'Autorização incompleta.');
   const short=await exchange({code,redirect_uri:callback});if(!short?.access_token)throw fail(502,'Token não confirmado.');
   const long=await exchange({grant_type:'fb_exchange_token',fb_exchange_token:short.access_token});if(!long?.access_token)throw fail(502,'Token não confirmado.');
   const token=long.access_token,debug=await request('https://graph.facebook.com/'+version+'/debug_token?'+new URLSearchParams({input_token:token}),{headers:{Authorization:'Bearer '+app+'|'+appSecret}});
   if(!debug?.data?.is_valid||String(debug.data.app_id)!==app)throw fail(502,'Aplicativo do token não confere.');
   const permissions=await graph('me/permissions',token),scopes=(permissions.data||[]).filter(p=>p.status==='granted').map(p=>p.permission);
   if(!scopes.includes('pages_show_list'))throw fail(403,'A Meta não autorizou listar as Páginas.');
   let after,assets=[],seen=new Set();
   for(let page=0;page<10;page++){
    const result=await graph('me/accounts',token,{fields:'id,name,access_token,tasks,instagram_business_account{id,username,name}',limit:100,...(after?{after}:{})});
    for(const p of result.data||[]){if(!/^\d+$/.test(String(p.id))||!p.access_token||seen.has(p.id))continue;seen.add(p.id);
     const common={page_id:String(p.id),token:p.access_token,scopes,expires_at:debug.data.expires_at?new Date(debug.data.expires_at*1000).toISOString():null};
     assets.push({...common,key:'facebook_page:'+p.id,channel:'facebook_page',remote_id:String(p.id),name:String(p.name||p.id),handle:null});
     const ig=p.instagram_business_account;if(ig&&/^\d+$/.test(String(ig.id)))assets.push({...common,key:'instagram:'+ig.id,channel:'instagram',remote_id:String(ig.id),name:String(ig.name||ig.username||ig.id),handle:ig.username?'@'+ig.username:null});
    }
    if(!result.paging?.next)break;after=result.paging?.cursors?.after;if(!after||page===9)throw fail(502,'A listagem não foi concluída. Revise os ativos autorizados.');
   }
   await admin('smit_oauth_attempts?id=eq.'+attempt.id+'&'+own+'&status=eq.processing','PATCH',{status:'ready',encrypted_payload:seal({assets},key,'attempt:'+attempt.id)});
   return redirect('ready');
  }catch{await admin('smit_oauth_attempts?id=eq.'+attempt.id+'&'+own,'PATCH',{status:'error',encrypted_payload:null});return redirect('failed');}
 }
 if(path==='/oauth/pending'&&req.method==='GET'){
  const rows=await admin('smit_oauth_attempts?'+own+'&status=eq.ready&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.desc&limit=1');
  return json(rows.map(r=>({id:r.id,assets:unseal(r.encrypted_payload,key,'attempt:'+r.id).assets.map(publicAsset)})));
 }
 if(path==='/oauth/meta/select'&&req.method==='POST'){
  if(!/^[0-9a-f-]{36}$/i.test(body.attempt_id)||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>20||body.keys.some(k=>typeof k!=='string'))throw fail(400,'Escolha as contas desta autorização.');
  const filter='smit_oauth_attempts?id=eq.'+body.attempt_id+'&'+own+'&status=eq.ready&expires_at=gt.'+encodeURIComponent(new Date().toISOString());
  const rows=await admin(filter);if(rows.length!==1)throw fail(409,'A autorização expirou ou já foi utilizada. Reconecte.');
  const payload=unseal(rows[0].encrypted_payload,key,'attempt:'+body.attempt_id),keys=[...new Set(body.keys)],assets=keys.map(k=>payload.assets.find(a=>a.key===k));if(assets.some(a=>!a))throw fail(400,'Conta não retornada nesta autorização.');
  const claim=await admin(filter,'PATCH',{status:'processing'});if(claim.length!==1)throw fail(409,'Esta autorização já está em uso.');
  try{
   for(const asset of assets){
    const verified=await graph(asset.remote_id,asset.token,{fields:asset.channel==='instagram'?'id,username,name':'id,name'});if(String(verified.id)!==asset.remote_id)throw fail(502,'A identidade da conta mudou.');
    const accounts=await admin('smit_accounts?on_conflict=channel,remote_id','POST',{channel:asset.channel,remote_id:asset.remote_id,name:String(verified.name||asset.name),handle:verified.username?'@'+verified.username:asset.handle,scopes:asset.scopes,publishing_enabled:false,metadata:{page_id:asset.page_id},verified_at:null},'resolution=merge-duplicates,return=representation');
    const id=accounts[0].id;await admin('smit_account_secrets?on_conflict=account_id','POST',{account_id:id,ciphertext:seal({token:asset.token},key,'account:'+id),expires_at:asset.expires_at,updated_at:new Date().toISOString()},'resolution=merge-duplicates,return=representation');
    await admin('smit_accounts?id=eq.'+id,'PATCH',{verified_at:new Date().toISOString()});
   }
   await admin('smit_oauth_attempts?id=eq.'+body.attempt_id+'&'+own,'PATCH',{status:'connected',encrypted_payload:null});return json({connected:assets.length,publishing_enabled:false});
  }catch(e){await admin('smit_oauth_attempts?id=eq.'+body.attempt_id+'&'+own,'PATCH',{status:'error',encrypted_payload:null});throw e;}
 }
 const match=path.match(/^\/accounts\/([0-9a-f-]{36})\/verify$/i);
 if(match&&req.method==='POST'){
  const accounts=await admin('smit_accounts?id=eq.'+match[1]+'&select=id,channel,remote_id');if(accounts.length!==1)throw fail(404,'Conta não encontrada.');
  const secrets=await admin('smit_account_secrets?account_id=eq.'+match[1]);if(secrets.length!==1)throw fail(409,'Reconecte esta conta.');
  if(secrets[0].expires_at&&Date.parse(secrets[0].expires_at)<=Date.now())throw fail(409,'O acesso expirou. Reconecte esta conta.');
  const account=accounts[0],token=unseal(secrets[0].ciphertext,key,'account:'+account.id).token;
  const debug=await request('https://graph.facebook.com/'+version+'/debug_token?'+new URLSearchParams({input_token:token}),{headers:{Authorization:'Bearer '+app+'|'+appSecret}});
  if(!debug.data?.is_valid||String(debug.data.app_id)!==app){await admin('smit_accounts?id=eq.'+account.id,'PATCH',{verified_at:null});throw fail(409,'Acesso inválido ou de outro aplicativo. Reconecte a conta.');}
  const actual=await graph(account.remote_id,token,{fields:'id,name'});if(String(actual.id)!==account.remote_id)throw fail(502,'A identidade não confere.');
  const scopes=Array.isArray(debug.data.scopes)?debug.data.scopes.filter(s=>typeof s==='string'):null;
  await admin('smit_accounts?id=eq.'+account.id,'PATCH',{verified_at:new Date().toISOString(),...(scopes?{scopes}:{})});return json({verified:true,permissions_checked:!!scopes});
 }
 throw fail(404,'Operação de conexão não disponível.');
}
