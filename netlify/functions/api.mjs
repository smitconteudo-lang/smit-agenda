import {csrf,equal,cookieToken,sameOrigin,allowedEmail} from '../../src/security.mjs';
import {metaRoute,configured as metaConfigured} from '../../src/meta.mjs';
import {providerRoute,providerStatus} from '../../src/providers.mjs';
import {backend,checked,publishingOn,safeJob} from '../../src/backend.mjs';
import {schedulingRoute} from '../../src/scheduling.mjs';
import {accountReadiness} from '../../src/readiness.mjs';
const env=k=>globalThis.Netlify?.env?.get(k)??process.env[k];
const failure=(status,message)=>Object.assign(new Error(message),{status});
const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
async function fetchJSON(url,options={}){let res;try{res=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw failure(502,'O serviço não confirmou a resposta. Atualize antes de repetir.');}const data=await res.json().catch(()=>null);return {res,data};}
export default async function handler(req){try{
 const url=new URL(req.url),path=url.pathname.replace(/^\/api/,'');
 if(path==='/health'&&req.method==='GET')return json({ok:true,version:'0.6.0',publishing_enabled:publishingOn(env),worker_enabled:publishingOn(env),meta_configured:metaConfigured(env),providers:providerStatus(env),database_configured:!!env('SMIT_SUPABASE_URL')&&!!env('SMIT_SUPABASE_PUBLISHABLE_KEY')});
 const base=env('SMIT_BASE_URL'),supa=env('SMIT_SUPABASE_URL'),key=env('SMIT_SUPABASE_PUBLISHABLE_KEY'),allowed=env('SMIT_ALLOWED_EMAILS');
 if(!base||!supa||!key||!allowed)throw failure(503,'Conclua a configuração da instalação no Netlify.');
 if(!['GET','POST'].includes(req.method))throw failure(405,'Método não permitido.');
 if(req.method==='POST'&&!sameOrigin(req,base))throw failure(403,'Origem não autorizada.');
 let body={};if(req.method==='POST'){const raw=await req.text();if(Buffer.byteLength(raw)>35000)throw failure(413,'Conteúdo muito grande.');try{body=JSON.parse(raw);}catch{throw failure(400,'Conteúdo inválido.');}}
 if(path==='/login'&&req.method==='POST'){
  if(typeof body.email!=='string'||!allowedEmail(body.email,allowed))throw failure(403,'Use um e-mail autorizado da equipe SMIT.');
  const {res}=await fetchJSON(supa+'/auth/v1/otp?redirect_to='+encodeURIComponent(base+'/'),{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:body.email.trim().toLowerCase(),create_user:true})});
  if(!res.ok)throw failure(res.status===429?429:502,'Não foi possível enviar o link de acesso. Confira a configuração de e-mail e aguarde antes de tentar de novo.');
  return json({sent:true});
 }
 let token=path==='/session'?body.access_token:cookieToken(req.headers.get('cookie')||'');
 if(typeof token!=='string'||token.length<50||token.length>3500)throw failure(401,'Entre na plataforma.');
 const auth=await fetchJSON(supa+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token}});
 if(!auth.res.ok||!auth.data?.id||!auth.data.email_confirmed_at)throw failure(401,'O acesso expirou. Entre novamente.');
 if(!allowedEmail(auth.data.email,allowed))throw failure(403,'Este e-mail não está autorizado.');
 const access=await checked(backend(env).from('smit_access').select('active').eq('email',auth.data.email.toLowerCase()).eq('active',true).limit(1));if(!access.length)throw failure(403,'O acesso desta conta à equipe foi desativado.');
 const me={id:auth.data.id,email:auth.data.email,csrf:csrf(token)};
 if(path==='/session'&&req.method==='POST')return json(me,200,{'Set-Cookie':'__Host-smit_session='+encodeURIComponent(token)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600'});
 if(req.method==='POST'&&!equal(req.headers.get('X-CSRF-Token'),me.csrf))throw failure(403,'Atualize a página antes de continuar.');
 if(path==='/me'&&req.method==='GET')return json(me);
 if(path==='/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':'__Host-smit_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
 if(path.startsWith('/media/')||/^\/posts\/[^/]+\/(schedule|simulate|cancel)$/.test(path)||/^\/jobs\/[^/]+\/confirm$/.test(path)||path==='/queue')return await schedulingRoute({req,path,body,me,env,json});
 if(path==='/oauth/pending'||/^\/oauth\/(google|linkedin)\//.test(path))return await providerRoute({req,url,path,body,me,env,json});
 if(path.startsWith('/oauth/meta/'))return await metaRoute({req,url,path,body,me,env,json});
 if(path.startsWith('/accounts/')){const match=path.match(/^\/accounts\/([0-9a-f-]{36})\/verify$/i);if(!match)throw failure(404,'Operação de conta não disponível.');const accounts=await db('smit_accounts?id=eq.'+match[1]+'&select=channel');if(accounts.length!==1)throw failure(404,'Conta não encontrada.');const handler=['youtube','linkedin'].includes(accounts[0].channel)?providerRoute:metaRoute;return await handler({req,url,path,body,me,env,json});}
 async function db(path,method='GET',data){const r=await fetchJSON(supa+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:data===undefined?undefined:JSON.stringify(data)});if(!r.res.ok){if(r.data?.code==='40001')throw failure(409,'A publicação mudou em outra sessão. Atualize a página.');throw failure(502,'O banco não confirmou a operação. Confira as permissões e atualize antes de repetir.');}return r.data;}
 if(path==='/workspace'&&req.method==='GET'){
  const client=backend(env);
  const [settings,posts,accounts,reports,jobs,media,secrets]=await Promise.all([db('smit_settings?select=brand&id=eq.workspace'),db('smit_posts?select=payload&order=updated_at.desc&limit=500'),db('smit_accounts?select=id,channel,remote_id,name,handle,scopes,verified_at,publishing_enabled'),db('smit_reports?select=payload&order=observed_at.desc&limit=100'),checked(client.from('smit_jobs').select('id,post_id,version,account_id,scheduled_at,status,remote_id,last_error,updated_at').order('scheduled_at',{ascending:false}).limit(1000)),db('smit_media?select=id,name,mime,bytes,status&status=eq.ready&order=created_at.desc&limit=500'),checked(client.from('smit_account_secrets').select('account_id,expires_at'))]);
  return json({version:'0.6.0',observed_at:new Date().toISOString(),connections:providerStatus(env),capabilities:{publishing:publishingOn(env),simulation:true,metrics_collection:false},brand:settings[0]?.brand||{name:'SMIT',guidelines:''},posts:posts.map(x=>x.payload),jobs:jobs.map(safeJob),media,accounts:accounts.map(a=>({id:a.id,channel:a.channel,remote_id:a.remote_id,name:a.name,handle:a.handle,verified_at:a.verified_at,...accountReadiness(a,secrets.find(s=>s.account_id===a.id),env),delivery_validated:jobs.some(j=>j.account_id===a.id&&j.status==='published'&&j.remote_id),verified:!!a.verified_at,insights:a.scopes.some(s=>['instagram_manage_insights','read_insights','r_organization_social','https://www.googleapis.com/auth/yt-analytics.readonly'].includes(s))})),reports:reports.map(x=>x.payload)});
 }
 if(path==='/brand'&&req.method==='POST'){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80||typeof body.guidelines!=='string'||body.guidelines.length>12000)throw failure(400,'Orientações inválidas.');
  return json(await db('smit_settings?id=eq.workspace','PATCH',{brand:{name:body.name.trim(),guidelines:body.guidelines},updated_at:new Date().toISOString()}));
 }
 if(path==='/posts'&&req.method==='POST'){
  if(!/^[0-9a-f-]{36}$/i.test(body.id)||!Number.isInteger(body.version)||body.version<0||typeof body.title!=='string'||!body.title.trim()||body.title.length>120||typeof body.caption!=='string'||body.caption.length>5000||typeof body.front!=='string'||body.front.length>80||typeof body.media_name!=='string'||body.media_name.length>255||!['Imagem','Carrossel','Vídeo / Reel','Texto','Story'].includes(body.format)||!Array.isArray(body.destinations)||body.destinations.length>4||body.destinations.some(x=>!['instagram','facebook_page','linkedin','youtube'].includes(x))||!Array.isArray(body.media_ids)||body.media_ids.length>10||new Set(body.media_ids).size!==body.media_ids.length||body.media_ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw failure(400,'Confira os campos da publicação.');
  const client=backend(env);if(body.media_ids.length){const rows=await checked(client.from('smit_media').select('id').in('id',body.media_ids).eq('status','ready'));if(rows.length!==body.media_ids.length)throw failure(400,'Aguarde o envio das mídias.');}
  const payload={id:body.id,version:body.version+1,title:body.title.trim(),caption:body.caption,front:body.front,media_name:body.media_name,media_ids:body.media_ids,format:body.format,destinations:[...new Set(body.destinations)],status:'draft',planned_local:null,approved_version:null,updated:Date.now()/1000};
  return json(await checked(client.rpc('smit_save_draft',{p_actor:me.id,p_id:body.id,p_expected:body.version,p_payload:payload})));
 }
 const match=path.match(/^\/posts\/([0-9a-f-]{36})\/plan$/i);
 if(match&&req.method==='POST'){
  throw failure(409,'Reabra a publicação e use Agendar publicação para escolher as contas e criar a fila.');
 }
 throw failure(404,'Operação não disponível nesta versão.');
 }catch(e){return json({detail:e.status?e.message:'Não foi possível concluir a operação.'},e.status||500);}}
export const config={path:'/api/*',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:60}};
