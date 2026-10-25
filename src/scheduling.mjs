import {randomUUID} from 'node:crypto';
import {backend,checked,problem,publishingOn,accountReady,bucket,safeJob,validatePublication} from './backend.mjs';
import {localDate} from './security.mjs';
import {reconcile} from './reconcile.mjs';

export function mediaSignature(bytes,mime){const b=Buffer.from(bytes);return mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='video/mp4'&&b.subarray(4,8).toString()==='ftyp';}
export async function schedulingRoute({req,path,body,me,env,json,client=backend(env)}){
 const storage=client.storage.from(bucket);
 const confirm=path.match(/^\/jobs\/([0-9a-f-]{36})\/confirm$/i);if(confirm&&req.method==='POST')return json(await reconcile({client,env,me,id:confirm[1],remote:body.remote_id}));
 if(path==='/media/start'&&req.method==='POST'){
  if(typeof body.name!=='string'||body.name.length>255||!['image/jpeg','image/png','video/mp4'].includes(body.mime)||!Number.isInteger(body.bytes)||body.bytes<1||body.bytes>50*1024*1024)throw problem(400,'Use JPEG, PNG ou MP4 de até 50 MB por arquivo.');
  const id=randomUUID(),object_path=id+'/'+({"image/jpeg":"image.jpg","image/png":"image.png","video/mp4":"video.mp4"}[body.mime]);
  await checked(client.from('smit_media').insert({id,user_id:me.id,name:body.name,object_path,mime:body.mime,bytes:body.bytes}));
  const signed=await checked(storage.createSignedUploadUrl(object_path,{upsert:false}));
  return json({id,upload_url:signed.signedUrl,storage_origin:new URL(env('SMIT_SUPABASE_URL')).origin});
 }
 let match=path.match(/^\/media\/([0-9a-f-]{36})\/(complete|preview)$/i);
 if(match){
  const media=await checked(client.from('smit_media').select('*').eq('id',match[1]).single());
  if(match[2]==='complete'&&req.method==='POST'){
   if(media.user_id!==me.id)throw problem(403,'Este upload pertence a outra sessão da equipe.');
   if(media.status==='ready')return json({ready:true});
   const info=await checked(storage.info(media.object_path));if(info.size!==media.bytes||info.contentType!==media.mime)throw problem(400,'Tamanho ou formato do arquivo não conferem.');
   const {signedUrl}=await checked(storage.createSignedUrl(media.object_path,60));const response=await fetch(signedUrl,{headers:{Range:'bytes=0-31'},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw problem(502,'O armazenamento não confirmou o arquivo.');const reader=response.body.getReader();const chunks=[];let count=0;try{while(count<32){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value).subarray(0,32-count));count+=chunks.at(-1).length;}}finally{await reader.cancel();}if(!mediaSignature(Buffer.concat(chunks),media.mime))throw problem(400,'O conteúdo do arquivo não corresponde ao formato informado.');
   await checked(client.from('smit_media').update({status:'ready'}).eq('id',media.id));return json({ready:true});
  }
  if(match[2]==='preview'&&req.method==='GET'){if(media.status!=='ready')throw problem(409,'Upload incompleto.');return json(await checked(storage.createSignedUrl(media.object_path,300)));}
 }
 match=path.match(/^\/posts\/([0-9a-f-]{36})\/(schedule|cancel)$/i);
 if(match&&req.method==='POST'){
  if(match[2]==='cancel'){await checked(client.rpc('smit_cancel_schedule',{p_actor:me.id,p_id:match[1]}));return json({cancelled:true});}
  if(!publishingOn(env))throw problem(503,'O processamento automático está pausado.');
  let at;try{at=localDate(body.when);}catch{throw problem(400,'Data inválida.');}
  if(+at<Date.now()+120000||+at>Date.now()+366*86400000||!Array.isArray(body.account_ids)||body.account_ids.length<1||body.account_ids.length>10||body.account_ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw problem(400,'Escolha contas válidas e uma data entre dois minutos e um ano à frente.');
  const post=await checked(client.from('smit_posts').select('version,payload').eq('id',match[1]).single());if(post.version!==body.version)throw problem(409,'A versão mudou. Reabra a publicação.');
  const ids=[...new Set(body.account_ids)],accounts=await checked(client.from('smit_accounts').select('*').in('id',ids));if(accounts.length!==ids.length)throw problem(400,'Uma conta não foi encontrada.');
  const mediaIds=post.payload.media_ids||[],media=mediaIds.length?await checked(client.from('smit_media').select('*').in('id',mediaIds)):[];if(media.length!==mediaIds.length)throw problem(400,'Uma mídia não foi encontrada.');const ordered=mediaIds.map(id=>media.find(m=>m.id===id));
  const destinations=accounts.map(a=>{if(!accountReady(a,env))throw problem(409,'A conta '+a.name+' precisa da permissão de publicação. Abra Contas e reconecte.');return {account_id:a.id,payload:validatePublication(post.payload,a,ordered,body.settings?.[a.id]||{})};});
  const secrets=await checked(client.from('smit_account_secrets').select('account_id,expires_at').in('account_id',ids));for(const a of accounts){const s=secrets.find(x=>x.account_id===a.id);if(!s||(s.expires_at&&Date.parse(s.expires_at)<+at&&['instagram','facebook_page'].includes(a.channel)))throw problem(409,'O acesso de '+a.name+' expira antes desta data. Reconecte ou escolha outra data.');}
  return json(await checked(client.rpc('smit_schedule',{p_actor:me.id,p_id:match[1],p_version:body.version,p_at:at.toISOString(),p_local:body.when,p_destinations:destinations})));
 }
 if(path==='/queue'&&req.method==='GET'){const jobs=await checked(client.from('smit_jobs').select('id,post_id,version,account_id,scheduled_at,status,remote_id,last_error,updated_at').order('scheduled_at',{ascending:false}).limit(500));return json(jobs.map(safeJob));}
 throw problem(404,'Operação de agendamento não disponível.');
}
