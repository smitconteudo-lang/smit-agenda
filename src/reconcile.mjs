import {createHmac} from 'node:crypto';
import {checked,problem} from './backend.mjs';
import {unseal} from './meta.mjs';

// Read-only reconciliation. This route never retries a publishing request.
export async function reconcile({client,env,me,id,remote,fetcher=fetch}){
 if(typeof remote!=='string'||remote.length>150||!remote.trim())throw problem(400,'Informe o identificador da publicação na rede.');
 const job=await checked(client.from('smit_jobs').select('*').eq('id',id).single());if(job.status!=='unknown')throw problem(409,'Esta publicação não possui uma confirmação pendente.');
 if(job.remote_id&&String(job.remote_id)!==remote)throw problem(409,'Use o identificador já registrado para este envio. A conferência não pode confirmar outra publicação.');
 const account=await checked(client.from('smit_accounts').select('*').eq('id',job.account_id).single());
 const secret=await checked(client.from('smit_account_secrets').select('ciphertext').eq('account_id',account.id).single());
 const {token}=unseal(secret.ciphertext,env('SMIT_TOKEN_ENCRYPTION_KEY'),'account:'+account.id),headers={Authorization:'Bearer '+token};
 async function read(url){const r=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw problem(409,'A rede não confirmou a publicação. Verifique o identificador e reconecte a conta se o acesso expirou.');return r.json();}
 let found=false;
 if(account.channel==='instagram'){
  if(!/^\d+$/.test(remote))throw problem(400,'Use o ID numérico da mídia Instagram.');
  let after;for(let page=0;page<5&&!found;page++){const u=new URL('https://graph.facebook.com/'+env('SMIT_META_API_VERSION')+'/'+account.remote_id+'/'+(job.payload.format==='Story'?'stories':'media'));u.search=new URLSearchParams({fields:'id,caption',limit:'100',appsecret_proof:createHmac('sha256',env('SMIT_META_APP_SECRET')).update(token).digest('hex'),...(after?{after}:{})}).toString();const result=await read(u);found=(result.data||[]).some(m=>String(m.id)===remote&&(job.payload.format==='Story'||(m.caption||'')===job.payload.caption));after=result.paging?.cursors?.after;if(!result.paging?.next)break;}
 }else if(account.channel==='facebook_page'){
  if(!/^\d+(?:_\d+)?$/.test(remote))throw problem(400,'Use o ID da publicação ou do vídeo Facebook.');
  const u=new URL('https://graph.facebook.com/'+env('SMIT_META_API_VERSION')+'/'+remote);u.search=new URLSearchParams({fields:'id,from',appsecret_proof:createHmac('sha256',env('SMIT_META_APP_SECRET')).update(token).digest('hex')}).toString();const result=await read(u);found=String(result.from?.id)===account.remote_id;
 }else if(account.channel==='linkedin'){
  if(!/^urn:li:(share|ugcPost):\d+$/.test(remote))throw problem(400,'Use o identificador urn:li:share ou urn:li:ugcPost.');
  Object.assign(headers,{'LinkedIn-Version':env('SMIT_LINKEDIN_API_VERSION'),'X-Restli-Protocol-Version':'2.0.0'});const result=await read('https://api.linkedin.com/rest/posts/'+encodeURIComponent(remote));found=result.author==='urn:li:organization:'+account.remote_id&&result.lifecycleState==='PUBLISHED'&&result.commentary===job.payload.caption;
 }else if(account.channel==='youtube'){
  if(!/^[\w-]{11}$/.test(remote))throw problem(400,'Use o ID de 11 caracteres do vídeo YouTube.');
  const result=await read('https://www.googleapis.com/youtube/v3/videos?'+new URLSearchParams({part:'snippet,status',id:remote})),v=result.items?.[0];found=v?.id===remote&&v.snippet?.channelId===account.remote_id&&v.status?.privacyStatus===job.payload.options.privacy&&v.snippet.title===job.payload.title&&(v.snippet.description||'')===job.payload.caption&&v.status?.uploadStatus==='processed';
 }
 if(!found)throw problem(409,'A publicação não foi confirmada nesta conta com o conteúdo e a visibilidade esperados. A fila continua bloqueada para evitar repetição.');
 if(!await checked(client.rpc('smit_confirm_delivery',{p_actor:me.id,p_id:id,p_remote:remote})))throw problem(409,'A situação mudou. Atualize a fila.');
 return {confirmed:true};
}
