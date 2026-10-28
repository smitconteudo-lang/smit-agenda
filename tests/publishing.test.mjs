import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {advancePublication,allowedUpload,ProviderError} from '../src/publishers.mjs';
import {accountReady,validatePublication} from '../src/backend.mjs';
import {mediaSignature} from '../src/scheduling.mjs';
import {validDispatch} from '../netlify/functions/publish-worker.mjs';
import {runWorker} from '../src/worker.mjs';
import {reconcile} from '../src/reconcile.mjs';
import {seal,unseal} from '../src/meta.mjs';

const image={id:'asset',object_path:'asset/image.jpg',name:'photo.jpg',mime:'image/jpeg',bytes:3,status:'ready'};
const video={...image,object_path:'asset/video.mp4',name:'video.mp4',mime:'video/mp4',bytes:6};
const settings={SMIT_META_API_VERSION:'v99.0',SMIT_META_APP_SECRET:'test-only',SMIT_LINKEDIN_API_VERSION:'209901',SMIT_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),SMIT_SUPABASE_SECRET_KEY:'test-only',SMIT_GOOGLE_CLIENT_ID:'test',SMIT_GOOGLE_CLIENT_SECRET:'test'};
const config=k=>settings[k];
function context(channel,options={}){const c={payload:{channel,remote_id:channel==='youtube'?'UCtest':'123',caption:'Confirmed text',title:'Example',format:'Imagem',media:[image],options:{privacy:'public',made_for_kids:false,notify_subscribers:true}},progress:{},token:'test-token',config,scheduled_at:new Date(0).toISOString(),now:100000,fences:0,checkpoints:[],mediaURL:async()=> 'https://storage.example/private',fetcher:async()=>{throw Error('Unexpected request');}};Object.assign(c,options);c.startSend=async()=>{c.fences++;};c.checkpoint=async p=>{c.checkpoints.push(structuredClone(p));};return c;}
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});

test('publication validation enforces media, limits and explicit YouTube audience',()=>{
 const post={caption:'Text',title:'Title',format:'Imagem'},a={channel:'instagram',remote_id:'123'};
 assert.equal(validatePublication(post,a,[image]).remote_id,'123');
 assert.throws(()=>validatePublication(post,a,[{...image,mime:'image/png'}]),/JPEG/);
 assert.throws(()=>validatePublication({...post,format:'Carrossel'},a,[image]),/2 a 10/);
 assert.throws(()=>validatePublication({...post,caption:'x'.repeat(2201)},a,[image]),/limite/);
 assert.throws(()=>validatePublication({...post,format:'Texto'},a,[]),/Texto/);
 assert.throws(()=>validatePublication({...post,format:'Vídeo / Reel'},{channel:'youtube'},[video],{privacy:'public'}),/público infantil/);
 assert.equal(validatePublication({...post,format:'Vídeo / Reel'},{channel:'youtube'},[video],{privacy:'private',made_for_kids:false}).options.made_for_kids,false);
});
test('connected identity alone does not grant publishing; required live scopes do',()=>{
 assert.equal(accountReady({channel:'instagram',verified_at:'now',scopes:['instagram_basic']},config),false);
 assert.equal(accountReady({channel:'instagram',verified_at:'now',scopes:['instagram_content_publish']},config),true);
 assert.equal(accountReady({channel:'youtube',verified_at:'now',scopes:['https://www.googleapis.com/auth/youtube.upload']},config),false);
 assert.equal(accountReady({channel:'youtube',verified_at:'now',scopes:['https://www.googleapis.com/auth/youtube.force-ssl']},config),true);
});
test('media magic bytes and provider upload origins reject disguised files and SSRF',()=>{
 assert.equal(mediaSignature([255,216,255],'image/jpeg'),true);assert.equal(mediaSignature(Buffer.from('<script>'),'image/jpeg'),false);
 assert.equal(mediaSignature(Buffer.from('0000ftyp'),'video/mp4'),true);
 for(const u of ['http://rupload.facebook.com/x','https://rupload.facebook.com.evil.test/x','https://user@www.googleapis.com/x','https://127.0.0.1/x'])assert.throws(()=>allowedUpload(u,'meta'));
 assert.equal(allowedUpload('https://rupload.facebook.com/video','meta'),'https://rupload.facebook.com/video');
});
for(const format of ['Imagem','Carrossel','Vídeo / Reel','Story'])test('Instagram '+format+': private preparation, then fenced publication when due',async()=>{
 const c=context('instagram');c.payload.format=format;c.payload.media=format==='Carrossel'?[image,{...image,id:'two'}]:format==='Vídeo / Reel'?[video]:[image];let containers=0,published=0;
 c.fetcher=async(u,o)=>{const url=new URL(u);assert.equal(o.headers.Authorization,'Bearer test-token');if(url.pathname.endsWith('/media')){containers++;const b=new URLSearchParams(o.body);if(format==='Story')assert.equal(b.get('media_type'),'STORIES');return json({id:'container-'+containers});}if(url.pathname.endsWith('/media_publish')){assert.equal(c.fences,1);published++;return json({id:'published'});}assert.equal(url.searchParams.get('fields'),'status_code');return json({status_code:'FINISHED'});};
 c.scheduled_at=new Date(c.now+60000).toISOString();assert.equal((await advancePublication(c)).status,'pending');assert.equal(c.fences,0);assert.equal((await advancePublication(c)).status,'pending');assert.equal(published,0);c.scheduled_at=new Date(0).toISOString();const r=await advancePublication(c);assert.equal(r.remote_id,'published');assert.equal(containers,format==='Carrossel'?3:1);assert.equal(published,1);
});
test('Instagram timeout after send is uncertain; HTTP 400 is a definitive failure',async()=>{
 const c=context('instagram',{progress:{container:'container'}});c.fetcher=async(u)=>String(u).includes('media_publish')?Promise.reject(Error('timeout')):json({status_code:'FINISHED'});
 await assert.rejects(()=>advancePublication(c),e=>e instanceof ProviderError&&e.uncertain);assert.equal(c.fences,1);
 c.fetcher=async u=>String(u).includes('media_publish')?json({error:{}},400):json({status_code:'FINISHED'});await assert.rejects(()=>advancePublication(c),e=>!e.uncertain);
});
test('Facebook photo album is private until one fenced feed call',async()=>{
 const c=context('facebook_page');c.payload.format='Carrossel';c.payload.media=[image,image];let n=0;
 c.fetcher=async(u,o)=>{const b=new URLSearchParams(o.body);if(String(u).includes('/photos?')){assert.equal(b.get('published'),'false');return json({id:'photo-'+(++n)});}assert.equal(c.fences,1);assert.deepEqual(JSON.parse(b.get('attached_media')),[{media_fbid:'photo-1'},{media_fbid:'photo-2'}]);return json({id:'post'});};assert.equal((await advancePublication(c)).remote_id,'post');assert.equal(n,2);
});
test('Facebook Reel confirms accepted publication without resending',async()=>{
 const c=context('facebook_page',{progress:{video:'video',uploaded:true,phase:'confirm',remote_id:'video'}});c.payload.media=[video];let reads=0;
 c.fetcher=async(u,o)=>{assert.equal(o.method,undefined);reads++;return json({id:'video',status:{publishing_phase:{status:reads===1?'in_progress':'complete'}}});};assert.equal((await advancePublication(c)).status,'confirming');assert.equal((await advancePublication(c)).status,'published');assert.equal(c.fences,0);
});
test('LinkedIn text publishes with empty 201 and x-restli-id header',async()=>{
 const c=context('linkedin');c.payload.media=[];c.payload.format='Texto';c.fetcher=async(u,o)=>{assert.equal(String(u),'https://api.linkedin.com/rest/posts');assert.equal(c.fences,1);const body=JSON.parse(o.body);assert.equal(body.author,'urn:li:organization:123');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:12345'}});};assert.equal((await advancePublication(c)).remote_id,'urn:li:share:12345');
});
test('LinkedIn image upload and readiness precede publication',async()=>{
 const c=context('linkedin');let uploads=0;
 c.fetcher=async(u,o)=>{const url=new URL(u);if(url.hostname==='storage.example')return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Length':'3'}});if(url.pathname.endsWith('/images')&&url.search){assert.equal(c.fences,0);return json({value:{image:'urn:li:image:123',uploadUrl:'https://www.linkedin.com/upload/image'}});}if(url.pathname==='/upload/image'){uploads++;return new Response(null,{status:201});}if(url.pathname.includes('/images/'))return json({status:'AVAILABLE'});const body=JSON.parse(o.body);assert.equal(body.content.media.id,'urn:li:image:123');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:12345'}});};assert.equal((await advancePublication(c)).status,'published');assert.equal(uploads,1);assert.equal(c.checkpoints.length,1);
});
test('YouTube initializes private, resumes verified offset and changes visibility only when due',async()=>{
 const c=context('youtube');c.payload.media=[video];c.payload.format='Vídeo / Reel';let chunks=0;
 c.fetcher=async(u,o)=>{const url=new URL(u);if(url.pathname==='/upload/youtube/v3/videos'){assert.equal(JSON.parse(o.body).status.privacyStatus,'private');assert.equal(c.fences,0);return new Response(null,{headers:{location:'https://www.googleapis.com/resumable/session'}});}if(url.pathname==='/resumable/session'){if(o.headers['Content-Range']==='bytes */6')return new Response(null,{status:308,headers:{Range:'bytes=0-2'}});assert.equal(o.headers['Content-Range'],'bytes 3-5/6');chunks++;return json({id:'video'});}if(url.hostname==='storage.example'){assert.equal(o.headers.Range,'bytes=3-5');return new Response(new Uint8Array([4,5,6]),{status:206,headers:{'Content-Length':'3'}});}if(o.method==='PUT'){assert.equal(c.fences,1);assert.equal(JSON.parse(o.body).status.privacyStatus,'public');return json({id:'video',status:{privacyStatus:'public'}});}return json({items:[{id:'video',snippet:{channelId:'UCtest'},processingDetails:{processingStatus:'succeeded'}}]});};
 assert.equal((await advancePublication(c)).status,'pending');assert.equal((await advancePublication(c)).status,'pending');assert.equal(chunks,1);c.scheduled_at=new Date(c.now+60000).toISOString();assert.equal((await advancePublication(c)).status,'pending');assert.equal(c.fences,0);c.scheduled_at=new Date(0).toISOString();assert.equal((await advancePublication(c)).status,'published');
});
test('YouTube refuses to publish a video belonging to another channel',async()=>{
 const c=context('youtube',{progress:{video:'video'}});c.payload.media=[video];c.fetcher=async()=>json({items:[{snippet:{channelId:'UCother'},processingDetails:{processingStatus:'succeeded'}}]});await assert.rejects(()=>advancePublication(c),/CANAL_NAO_CONFERE/);assert.equal(c.fences,0);
});
test('background dispatch requires a fresh signature; forged and expired calls fail',()=>{
 const old=process.env.SMIT_TOKEN_ENCRYPTION_KEY;process.env.SMIT_TOKEN_ENCRYPTION_KEY=settings.SMIT_TOKEN_ENCRYPTION_KEY;try{const now=2000000000000,stamp=String(now),signature=createHmac('sha256',settings.SMIT_TOKEN_ENCRYPTION_KEY).update('dispatch:'+stamp).digest('hex'),req=new Request('https://example.test/internal/publish-worker',{headers:{'X-SMIT-Time':stamp,'X-SMIT-Signature':signature}});assert.equal(validDispatch(req,now),true);assert.equal(validDispatch(req,now+60001),false);assert.equal(validDispatch(new Request(req.url),now),false);}finally{if(old===undefined)delete process.env.SMIT_TOKEN_ENCRYPTION_KEY;else process.env.SMIT_TOKEN_ENCRYPTION_KEY=old;}
});
test('worker persists uncertain send and encrypted progress without automatic retry',async()=>{
 const key=settings.SMIT_TOKEN_ENCRYPTION_KEY,job={id:'job',account_id:'account',lease_id:'lease',scheduled_at:new Date().toISOString(),payload:{remote_id:'123'}};let claims=0,finish;
 const client={rpc:async(name,args)=>{if(name==='smit_claim_job')return {data:claims++?[]:[job]};if(name==='smit_job_sending')return {data:true};if(name==='smit_job_finish'){finish=args;return {data:true};}throw Error(name);},from:table=>({select:()=>({eq:()=>({single:async()=>({data:table==='smit_accounts'?{id:'account',remote_id:'123',channel:'instagram',verified_at:'now',scopes:['instagram_content_publish']}:{ciphertext:seal({token:'private-token'},key,'account:account')}})})})})};
 const result=await runWorker({client,config,step:async c=>{assert.equal(c.token,'private-token');await c.startSend();throw new ProviderError('RESPOSTA_INTERROMPIDA',true);}});assert.equal(result.processed,1);assert.equal(finish.p_status,'unknown');assert.deepEqual(unseal(finish.p_progress,key,'job:job'),{});assert.ok(!JSON.stringify(finish).includes('private-token'));
});
test('reconciliation only reads the provider and requires matching account and content',async()=>{
 const key=settings.SMIT_TOKEN_ENCRYPTION_KEY;let saved=0,wrong=false;
 const client={from:t=>({select:()=>({eq:()=>({single:async()=>({data:t==='smit_jobs'?{status:'unknown',account_id:'account',payload:{format:'Imagem',caption:'expected'}}:t==='smit_accounts'?{id:'account',remote_id:'123',channel:'instagram'}:{ciphertext:seal({token:'token'},key,'account:account')}})})})}),rpc:async(name,args)=>{assert.equal(name,'smit_confirm_delivery');assert.equal(args.p_remote,'456');saved++;return {data:true};}};
 const invoke=()=>reconcile({client,env:config,me:{id:'member'},id:'job',remote:'456',fetcher:async(u,o)=>{assert.equal(o.method,undefined);assert.match(String(u),/\/123\/media/);return json({data:[{id:'456',caption:wrong?'another post':'expected'}]});}});
 assert.equal((await invoke()).confirmed,true);assert.equal(saved,1);wrong=true;await assert.rejects(invoke,/não foi confirmada/);assert.equal(saved,1);
});
for(const format of ['Texto','Imagem','Story'])test('Facebook '+format+': no early send; exactly one publishing fence',async()=>{
 const c=context('facebook_page');c.payload.format=format;c.payload.media=format==='Texto'?[]:[image];c.scheduled_at=new Date(c.now+60000).toISOString();let uploads=0,sends=0;
 c.fetcher=async(u,o)=>{const url=new URL(u),body=new URLSearchParams(o.body);if(url.pathname.endsWith('/photos')){uploads++;assert.equal(c.fences,0);assert.equal(body.get('published'),'false');return json({id:'photo-private'});}assert.equal(c.fences,1);sends++;if(format==='Story'){assert.ok(url.pathname.endsWith('/photo_stories'));assert.equal(body.get('photo_id'),'photo-private');return json({success:true,post_id:'story-confirmed'});}assert.ok(url.pathname.endsWith('/feed'));assert.equal(body.get('message'),'Confirmed text');return json({id:'feed-confirmed'});};
 assert.equal((await advancePublication(c)).status,'pending');assert.equal(sends,0);c.scheduled_at=new Date(0).toISOString();assert.equal((await advancePublication(c)).status,'published');assert.equal(sends,1);assert.equal(uploads,format==='Texto'?0:1);
});
for(const format of ['Vídeo / Reel','Story'])test('Facebook video '+format+': resume private upload, send once and then only poll',async()=>{
 const c=context('facebook_page');c.payload.format=format;c.payload.media=[video];c.scheduled_at=new Date(c.now+60000).toISOString();let starts=0,uploads=0,finishes=0;
 c.fetcher=async(u,o)=>{const url=new URL(u);if(url.hostname==='rupload.facebook.com'){uploads++;assert.equal(c.fences,0);assert.equal(o.headers.file_url,'https://storage.example/private');return json({success:true});}if(!o.method){assert.equal(c.fences,1);return json({status:{publishing_phase:{status:'complete'}}});}const b=new URLSearchParams(o.body);assert.ok(url.pathname.endsWith(format==='Story'?'/video_stories':'/video_reels'));if(b.get('upload_phase')==='start'){starts++;return json({video_id:'video-private',upload_url:'https://rupload.facebook.com/video/test'});}assert.equal(b.get('upload_phase'),'finish');assert.equal(c.fences,1);finishes++;return json({success:true});};
 assert.equal((await advancePublication(c)).status,'pending');assert.equal((await advancePublication(c)).status,'pending');assert.equal(finishes,0);c.scheduled_at=new Date(0).toISOString();assert.equal((await advancePublication(c)).status,'confirming');assert.equal((await advancePublication(c)).status,'published');assert.deepEqual([starts,uploads,finishes,c.fences],[1,1,1,1]);
});
test('Facebook service error on publication is uncertain and cannot be treated as a safe retry',async()=>{
 const c=context('facebook_page');c.payload.media=[];c.payload.format='Texto';c.fetcher=async()=>json({error:{message:'temporary'}},503);await assert.rejects(()=>advancePublication(c),e=>e.code==='HTTP_503'&&e.uncertain===true);assert.equal(c.fences,1);
});
test('Instagram rejects media processing failure before attempting publication',async()=>{
 const c=context('instagram',{progress:{container:'private'}});c.fetcher=async()=>json({status_code:'ERROR'});await assert.rejects(()=>advancePublication(c),e=>e.code==='MIDIA_ERROR'&&!e.uncertain);assert.equal(c.fences,0);
});
test('Instagram successful HTTP without publication id remains uncertain',async()=>{
 const c=context('instagram',{progress:{container:'private'}});c.fetcher=async u=>String(u).includes('media_publish')?json({success:true}):json({status_code:'FINISHED'});await assert.rejects(()=>advancePublication(c),e=>e.code==='IDENTIFICADOR_AUSENTE'&&e.uncertain);assert.equal(c.fences,1);
});

test('trial Reel validates Instagram video only and preserves explicit manual sharing',async()=>{
 const post={caption:'Test',title:'Title',format:'Vídeo / Reel'},account={channel:'instagram',remote_id:'123'};
 assert.equal(validatePublication(post,account,[video],{trial_reel:true}).options.trial_reel,true);
 for(const [a,p,o] of [[{channel:'youtube'},post,{trial_reel:true}],[account,{...post,format:'Story'},{trial_reel:true}],[account,post,{trial_reel:'true'}]])assert.throws(()=>validatePublication(p,a,[video],o),/teste/);
 const c=context('instagram');c.payload=validatePublication(post,account,[video],{trial_reel:true});let containers=0;
 c.fetcher=async(u,o)=>{if(new URL(u).pathname.endsWith('/media')){containers++;const b=new URLSearchParams(o.body);assert.equal(b.get('media_type'),'REELS');assert.deepEqual(JSON.parse(b.get('trial_params')),{graduation_strategy:'MANUAL'});return json({id:'trial-container'});}if(new URL(u).pathname.endsWith('/media_publish')){assert.equal(c.fences,1);return json({id:'trial-published'});}return json({status_code:'FINISHED'});};
 assert.equal((await advancePublication(c)).status,'pending');assert.equal(c.fences,0);assert.equal((await advancePublication(c)).remote_id,'trial-published');assert.equal(containers,1);
});
test('Instagram video Story uses STORIES and does not send trial parameters or caption',async()=>{
 const c=context('instagram');c.payload.format='Story';c.payload.media=[video];
 c.fetcher=async(u,o)=>{const b=new URLSearchParams(o.body);assert.equal(b.get('media_type'),'STORIES');assert.equal(b.has('trial_params'),false);assert.equal(b.has('caption'),false);return json({id:'story-container'});};
 assert.equal((await advancePublication(c)).status,'pending');assert.equal(c.fences,0);
 c.payload.options.trial_reel=true;await assert.rejects(()=>advancePublication(c),/REEL_TESTE_FORMATO/);
});

for(const uploadStatus of ['rejected','failed','deleted'])test('YouTube '+uploadStatus+' video fails before any public send',async()=>{
 const c=context('youtube',{progress:{video:'video'}});c.payload.media=[video];let calls=0;
 c.fetcher=async(u,o)=>{calls++;assert.equal(o.method,undefined);return json({items:[{id:'video',snippet:{channelId:'UCtest'},status:{uploadStatus},processingDetails:{processingStatus:'succeeded'}}]});};
 await assert.rejects(()=>advancePublication(c),e=>e.code==='VIDEO_ENVIO_'+uploadStatus.toUpperCase()&&!e.uncertain);assert.equal(c.fences,0);assert.equal(calls,1);
});
test('YouTube still processing waits without changing visibility or resending the file',async()=>{
 const c=context('youtube',{progress:{video:'video'}});c.payload.media=[video];c.fetcher=async(u,o)=>{assert.equal(o.method,undefined);return json({items:[{id:'video',snippet:{channelId:'UCtest'},status:{uploadStatus:'uploaded'},processingDetails:{processingStatus:'processing'}}]});};
 const result=await advancePublication(c);assert.equal(result.status,'pending');assert.equal(result.progress.video,'video');assert.equal(c.fences,0);
});
for(const response of ['wrong-id','wrong-privacy','timeout'])test('YouTube '+response+' on visibility update requires reconciliation',async()=>{
 const c=context('youtube',{progress:{video:'video'}});c.payload.media=[video];
 c.fetcher=async(u,o)=>{if(o.method==='PUT'){if(response==='timeout')throw Error('timeout');return json({id:response==='wrong-id'?'another-video':'video',status:{privacyStatus:response==='wrong-privacy'?'private':'public'}});}return json({items:[{id:'video',snippet:{channelId:'UCtest'},status:{uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});};
 await assert.rejects(()=>advancePublication(c),e=>e instanceof ProviderError&&e.uncertain);assert.equal(c.fences,1);
});
for(const discrepancy of ['none','caption','channel','privacy','title','id','processing','known-id'])test('YouTube reconciliation checks '+discrepancy+' without publishing',async()=>{
 const remote='abcdefghijk',key=settings.SMIT_TOKEN_ENCRYPTION_KEY;let saved=0,reads=0;
 const client={from:t=>({select:()=>({eq:()=>({single:async()=>({data:t==='smit_jobs'?{status:'unknown',account_id:'account',remote_id:discrepancy==='known-id'?'other-id':remote,payload:{caption:'expected description',title:'expected title',options:{privacy:'public'}}}:t==='smit_accounts'?{id:'account',remote_id:'UCtest',channel:'youtube'}:{ciphertext:seal({token:'test-only'},key,'account:account')}})})})}),rpc:async()=>{saved++;return {data:true};}};
 const invoke=()=>reconcile({client,env:config,me:{id:'member'},id:'job',remote,fetcher:async(u,o)=>{reads++;assert.equal(o.method,undefined);return json({items:[{id:discrepancy==='id'?'another-id':remote,snippet:{channelId:discrepancy==='channel'?'UCother':'UCtest',title:discrepancy==='title'?'another title':'expected title',description:discrepancy==='caption'?'another description':'expected description'},status:{privacyStatus:discrepancy==='privacy'?'private':'public',uploadStatus:discrepancy==='processing'?'uploaded':'processed'}}]});}});
 if(discrepancy==='none'){assert.equal((await invoke()).confirmed,true);assert.equal(saved,1);}else{await assert.rejects(invoke);assert.equal(saved,0);}assert.equal(reads,discrepancy==='known-id'?0:1);
});
