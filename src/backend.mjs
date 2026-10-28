import {createClient} from '@supabase/supabase-js';
export const env=k=>globalThis.Netlify?.env?.get(k)??process.env[k];
export const problem=(status,message)=>Object.assign(new Error(message),{status});
export function backend(config=env){const url=config('SMIT_SUPABASE_URL'),key=config('SMIT_SUPABASE_SECRET_KEY');if(!url||!key)throw problem(503,'Configure o banco no servidor.');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)})}});}
export async function checked(operation){const {data,error}=await operation;if(error)throw problem(error.code==='40001'?409:502,error.code==='40001'?'A versão mudou ou há um envio em andamento. Atualize antes de continuar.':'O banco não confirmou a operação. Atualize antes de repetir.');return data;}
export const publishingOn=(config=env)=>config('SMIT_PUBLISHING_ENABLED')!=='false'&&!!config('SMIT_TOKEN_ENCRYPTION_KEY')&&!!config('SMIT_SUPABASE_SECRET_KEY');
export function accountReady(a,config=env){if(!a.verified_at)return false;const s=a.scopes||[];return {instagram:s.includes('instagram_content_publish'),facebook_page:s.includes('pages_manage_posts'),linkedin:!!config('SMIT_LINKEDIN_CLIENT_ID')&&!!config('SMIT_LINKEDIN_CLIENT_SECRET')&&s.includes('w_organization_social'),youtube:!!config('SMIT_GOOGLE_CLIENT_ID')&&!!config('SMIT_GOOGLE_CLIENT_SECRET')&&s.includes('https://www.googleapis.com/auth/youtube.force-ssl')}[a.channel]||false;}
export const safeJob=j=>({id:j.id,post_id:j.post_id,version:j.version,account_id:j.account_id,scheduled_at:j.scheduled_at,status:j.status,remote_id:j.remote_id,last_error:j.last_error,updated_at:j.updated_at});
export const bucket='smit-media';
export function validatePublication(post,account,media,options={}){
 const channel=account.channel,caption=options.caption??post.caption,title=options.title??post.title,format=options.format??post.format;
 if(typeof caption!=='string'||caption.length>({instagram:2200,facebook_page:5000,linkedin:3000,youtube:5000}[channel]||0))throw problem(400,'A legenda ultrapassa o limite de '+channel+'.');
 if(options.trial_reel!==undefined&&typeof options.trial_reel!=='boolean')throw problem(400,'A opção Reel de teste deve ser verdadeira ou falsa.');
 if(options.trial_reel&&(channel!=='instagram'||format!=='Vídeo / Reel'))throw problem(400,'Reel de teste exige um vídeo e uma conta Instagram.');
 const videos=media.filter(m=>m.mime==='video/mp4'),images=media.filter(m=>m.mime.startsWith('image/'));
 if(media.some(m=>m.status!=='ready')||media.length>10)throw problem(400,'Aguarde o envio de todas as mídias.');
 if(images.some(m=>m.bytes>8*1024*1024))throw problem(400,'Use imagens de até 8 MB.');
 if(!['Texto','Imagem','Carrossel','Vídeo / Reel','Story'].includes(format))throw problem(400,'Formato inválido.');
 if(format==='Texto'&&(!caption.trim()||media.length||!['facebook_page','linkedin'].includes(channel)))throw problem(400,'Texto sem mídia só está disponível para Facebook e LinkedIn.');
 if(format==='Imagem'&&(media.length!==1||images.length!==1))throw problem(400,'Selecione uma imagem.');
 if(format==='Carrossel'&&(media.length<2||images.length!==media.length))throw problem(400,'O carrossel desta versão aceita de 2 a 10 imagens.');
 if(format==='Vídeo / Reel'&&(media.length!==1||videos.length!==1))throw problem(400,'Selecione um vídeo MP4.');
 if(format==='Story'&&(!['instagram','facebook_page'].includes(channel)||media.length!==1))throw problem(400,'Story exige uma mídia e uma conta Instagram ou Facebook.');
 if(channel==='instagram'&&images.some(m=>m.mime!=='image/jpeg'))throw problem(400,'O Instagram exige imagens JPEG. Exporte a arte em JPG.');
 if(channel==='youtube'&&(format!=='Vídeo / Reel'||!title?.trim()||title.length>100||typeof options.made_for_kids!=='boolean'||!['public','unlisted','private'].includes(options.privacy)))throw problem(400,'No YouTube, informe vídeo, título (até 100 caracteres), público infantil e visibilidade.');
 if(channel==='linkedin'&&format==='Story')throw problem(400,'LinkedIn não possui publicação de Stories.');
 return {channel,remote_id:account.remote_id,caption,title,format,media:media.map(m=>({id:m.id,object_path:m.object_path,mime:m.mime,bytes:m.bytes,name:m.name})),options:{trial_reel:options.trial_reel===true,made_for_kids:options.made_for_kids,privacy:options.privacy||'public',notify_subscribers:options.notify_subscribers!==false}};
}
