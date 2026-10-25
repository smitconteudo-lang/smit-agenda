import {createHmac} from 'node:crypto';

export function allowedUpload(url,provider){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Endereço de upload inválido.');const ok=provider==='meta'?u.hostname==='rupload.facebook.com':provider==='google'?u.hostname==='www.googleapis.com':u.hostname==='www.linkedin.com'||u.hostname.endsWith('.linkedin.com')||u.hostname.endsWith('.licdn.com');if(!ok)throw Error('Servidor de upload não autorizado.');return u.href;}
export class ProviderError extends Error{constructor(code,uncertain=false){super('O provedor não confirmou a operação ('+code+'). Confira a conta e o formato da mídia.');this.code=code;this.uncertain=uncertain;}}

// A step either prepares private media, confirms an already accepted send, or
// makes exactly one public publishing call protected by the durable send fence.
export async function advancePublication(ctx){
 const {payload:p,progress:s,token,config}=ctx,media=p.media||[],now=ctx.now??Date.now();
 const due=Date.parse(ctx.scheduled_at)<=now;
 const pending=(delay=30)=>({status:'pending',progress:s,next:new Date(now+delay*1000).toISOString()});
 const confirming=()=>({status:'confirming',progress:s,remote_id:s.remote_id,next:new Date(now+30000).toISOString()});
 const done=id=>{if(!id)throw new ProviderError('IDENTIFICADOR_AUSENTE',true);return {status:'published',progress:{},remote_id:String(id)};};
 async function raw(url,options={},publicSend=false){if(publicSend)await ctx.startSend();let r;try{r=await (ctx.fetcher||fetch)(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new ProviderError('RESPOSTA_INTERROMPIDA',publicSend);}if(!r.ok&&r.status!==308)throw new ProviderError('HTTP_'+r.status,publicSend&&(r.status>=500||r.status===408||r.status===429));return r;}
 async function data(url,options={},send=false){const r=await raw(url,options,send);let d;try{const text=await r.text();d=text?JSON.parse(text):r.headers.get('x-restli-id')?{}:null;if(!d)throw Error();}catch{throw new ProviderError('RESPOSTA_INVALIDA',send);}if(d?.error)throw new ProviderError('API_'+(d.error.code||'ERRO'),send);return {d,r};}
 const graphBase='https://graph.facebook.com/'+config('SMIT_META_API_VERSION')+'/';
 async function graph(edge,params={},send=false,method='POST'){const u=new URL(graphBase+edge);u.searchParams.set('appsecret_proof',createHmac('sha256',config('SMIT_META_APP_SECRET')).update(token).digest('hex'));const headers={Authorization:'Bearer '+token};if(method==='GET'){for(const [k,v]of Object.entries(params))u.searchParams.set(k,String(v));return (await data(u,{headers},send)).d;}headers['Content-Type']='application/x-www-form-urlencoded';return (await data(u,{method,headers,body:new URLSearchParams(params).toString()},send)).d;}
 const liHeaders={Authorization:'Bearer '+token,'LinkedIn-Version':config('SMIT_LINKEDIN_API_VERSION'),'X-Restli-Protocol-Version':'2.0.0'};
 async function li(edge,body,send=false){return data('https://api.linkedin.com/rest/'+edge,{method:body?'POST':'GET',headers:{...liHeaders,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined},send);}
 async function bytes(m,start=0,end=m.bytes-1){const u=await ctx.mediaURL(m),r=await raw(u,{headers:{Range:'bytes='+start+'-'+end}});const expected=end-start+1;if((r.status!==206&&expected!==m.bytes)||Number(r.headers.get('Content-Length'))>expected){await r.body?.cancel();throw new ProviderError('ARQUIVO_INTERVALO');}const b=await r.arrayBuffer();if(b.byteLength!==expected||b.byteLength>8*1024*1024)throw new ProviderError('ARQUIVO_TAMANHO');return b;}
 async function checkpoint(){await ctx.checkpoint(s);}
 if(p.channel==='instagram'){
  if(!s.container){
   if(p.format==='Carrossel'){
    s.children=s.children||[];
    for(let i=s.children.length;i<media.length;i++){const c=await graph(p.remote_id+'/media',{image_url:await ctx.mediaURL(media[i]),is_carousel_item:'true'});if(!c.id)throw new ProviderError('CONTAINER_AUSENTE');s.children.push(String(c.id));await checkpoint();}
    const c=await graph(p.remote_id+'/media',{media_type:'CAROUSEL',children:s.children.join(','),caption:p.caption});s.container=c.id;
   }else{const video=media[0]?.mime==='video/mp4';const params={...(video?{video_url:await ctx.mediaURL(media[0]),media_type:p.format==='Story'?'STORIES':'REELS'}:{image_url:await ctx.mediaURL(media[0]),...(p.format==='Story'?{media_type:'STORIES'}:{})}),...(p.format==='Story'?{}:{caption:p.caption})};const c=await graph(p.remote_id+'/media',params);s.container=c.id;}
   if(!s.container)throw new ProviderError('CONTAINER_AUSENTE');return pending();
  }
  const state=await graph(s.container,{fields:'status_code'},false,'GET');
  if(['ERROR','EXPIRED'].includes(state.status_code))throw new ProviderError('MIDIA_'+state.status_code);
  if(state.status_code==='PUBLISHED')throw new ProviderError('JA_PUBLICADO_CONFERIR',true);
  if(state.status_code!=='FINISHED'||!due)return pending();
  const result=await graph(p.remote_id+'/media_publish',{creation_id:s.container},true);return done(result.id);
 }
 if(p.channel==='facebook_page'){
  const video=media[0]?.mime==='video/mp4',story=p.format==='Story';
  if(!video){
   s.photos=s.photos||[];
   for(let i=s.photos.length;i<media.length;i++){const photo=await graph(p.remote_id+'/photos',{url:await ctx.mediaURL(media[i]),published:'false'});if(!photo.id)throw new ProviderError('FOTO_AUSENTE');s.photos.push(String(photo.id));await checkpoint();}
   if(!due)return pending();
   const result=await graph(p.remote_id+(story?'/photo_stories':'/feed'),story?{photo_id:s.photos[0]}:{message:p.caption,...(s.photos.length?{attached_media:JSON.stringify(s.photos.map(id=>({media_fbid:id})))}:{})},true);
   return done(result.post_id||result.id);
  }
  const edge=p.remote_id+(story?'/video_stories':'/video_reels');
  if(!s.video){const start=await graph(edge,{upload_phase:'start'});if(!start.video_id||!start.upload_url)throw new ProviderError('VIDEO_AUSENTE');s.video=String(start.video_id);s.upload_url=allowedUpload(start.upload_url,'meta');await checkpoint();}
  if(!s.uploaded){await data(s.upload_url,{method:'POST',headers:{Authorization:'OAuth '+token,file_url:await ctx.mediaURL(media[0])}});s.uploaded=true;return pending();}
  if(s.phase==='confirm'){
   const result=await graph(s.video,{fields:'id,status'},false,'GET');if(result.status?.publishing_phase?.status==='complete')return done(s.video);if(result.status?.video_status==='error')throw new ProviderError('VIDEO_PUBLICACAO_FALHOU',true);return confirming();
  }
  if(!due)return pending();
  const result=await graph(edge,{upload_phase:'finish',video_id:s.video,...(story?{}:{video_state:'PUBLISHED',description:p.caption})},true);if(!result.success)throw new ProviderError('VIDEO_SEM_CONFIRMACAO',true);s.phase='confirm';s.remote_id=s.video;return confirming();
 }
 if(p.channel==='linkedin'){
  const owner='urn:li:organization:'+p.remote_id,video=media[0]?.mime==='video/mp4';s.assets=s.assets||[];
  if(video){
   if(!s.upload){const {d}=await li('videos?action=initializeUpload',{initializeUploadRequest:{owner,fileSizeBytes:media[0].bytes,uploadCaptions:false,uploadThumbnail:false}});s.upload=d.value;if(!s.upload?.video||!Array.isArray(s.upload.uploadInstructions))throw new ProviderError('VIDEO_AUSENTE');s.part_ids=[];await checkpoint();}
   for(let i=s.part_ids.length;i<s.upload.uploadInstructions.length;i++){const part=s.upload.uploadInstructions[i];if(!Number.isInteger(part.firstByte)||!Number.isInteger(part.lastByte)||part.lastByte>=media[0].bytes)throw new ProviderError('PARTE_INVALIDA');const response=await raw(allowedUpload(part.uploadUrl,'linkedin'),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:await bytes(media[0],part.firstByte,part.lastByte)});const etag=response.headers.get('etag');if(!etag)throw new ProviderError('ETAG_AUSENTE');s.part_ids.push(etag.replace(/^"|"$/g,''));await checkpoint();}
   if(!s.finalized){await li('videos?action=finalizeUpload',{finalizeUploadRequest:{video:s.upload.video,uploadToken:s.upload.uploadToken||'',uploadedPartIds:s.part_ids}});s.finalized=true;return pending();}
   const {d}=await li('videos/'+encodeURIComponent(s.upload.video));if(d.status==='PROCESSING_FAILED')throw new ProviderError('VIDEO_FORMATO');if(d.status!=='AVAILABLE')return pending();s.assets=[s.upload.video];
  }else{
   for(let i=s.assets.length;i<media.length;i++){const {d}=await li('images?action=initializeUpload',{initializeUploadRequest:{owner}});if(!d.value?.image||!d.value?.uploadUrl)throw new ProviderError('IMAGEM_AUSENTE');await raw(allowedUpload(d.value.uploadUrl,'linkedin'),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':media[i].mime},body:await bytes(media[i])});s.assets.push(d.value.image);await checkpoint();}
   for(const id of s.assets){const {d}=await li('images/'+encodeURIComponent(id));if(d.status==='PROCESSING_FAILED')throw new ProviderError('IMAGEM_FORMATO');if(d.status!=='AVAILABLE')return pending();}
  }
  if(!due)return pending();
  const content=s.assets.length>1?{multiImage:{images:s.assets.map(id=>({id}))}}:s.assets.length?{media:{id:s.assets[0],title:p.title}}:null;
  const {d,r}=await li('posts',{author:owner,commentary:p.caption,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false,...(content?{content}:{})},true);
  return done(r.headers.get('x-restli-id')||d?.id);
 }
 if(p.channel==='youtube'){
  const headers={Authorization:'Bearer '+token};
  if(!s.upload_url&&!s.video){const r=await raw('https://www.googleapis.com/upload/youtube/v3/videos?'+new URLSearchParams({uploadType:'resumable',part:'snippet,status',notifySubscribers:String(p.options.notify_subscribers)}),{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Length':String(media[0].bytes),'X-Upload-Content-Type':'video/mp4'},body:JSON.stringify({snippet:{title:p.title,description:p.caption},status:{privacyStatus:'private',selfDeclaredMadeForKids:p.options.made_for_kids}})});s.upload_url=allowedUpload(r.headers.get('location'),'google');await checkpoint();return pending(1);}
  if(!s.video){
   const status=await raw(s.upload_url,{method:'PUT',headers:{...headers,'Content-Range':'bytes */'+media[0].bytes,'Content-Length':'0'}});
   if(status.status===200||status.status===201){const value=await status.json();s.video=value.id;if(!s.video)throw new ProviderError('VIDEO_AUSENTE');return pending();}
   const end=status.headers.get('range')?.match(/bytes=0-(\d+)/)?.[1],offset=end?Number(end)+1:0,last=Math.min(offset+8*1024*1024,media[0].bytes)-1;
   if(last<offset)throw new ProviderError('UPLOAD_SEM_RESULTADO',true);
   const result=await raw(s.upload_url,{method:'PUT',headers:{...headers,'Content-Type':'video/mp4','Content-Range':'bytes '+offset+'-'+last+'/'+media[0].bytes},body:await bytes(media[0],offset,last)});
   if(result.status!==308){const value=await result.json();if(!value.id)throw new ProviderError('VIDEO_AUSENTE');s.video=value.id;}return pending(1);
  }
  const {d}=await data('https://www.googleapis.com/youtube/v3/videos?'+new URLSearchParams({part:'id,snippet,status,processingDetails',id:s.video}),{headers});const actual=d.items?.[0];if(!actual||actual.snippet?.channelId!==p.remote_id)throw new ProviderError('CANAL_NAO_CONFERE');
  if(['failed','terminated'].includes(actual.processingDetails?.processingStatus))throw new ProviderError('VIDEO_PROCESSAMENTO');if(actual.processingDetails?.processingStatus!=='succeeded'||!due)return pending();
  const {d:result}=await data('https://www.googleapis.com/youtube/v3/videos?part=status',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:s.video,status:{privacyStatus:p.options.privacy,selfDeclaredMadeForKids:p.options.made_for_kids}})},true);
  if(result.status?.privacyStatus!==p.options.privacy)throw new ProviderError('VISIBILIDADE_NAO_CONFIRMADA',true);return done(result.id);
 }
 throw new ProviderError('REDE_NAO_SUPORTADA');
}
