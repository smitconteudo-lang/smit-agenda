import {backend,checked,env,publishingOn,accountReady,bucket} from './backend.mjs';
import {seal,unseal} from './meta.mjs';
import {advancePublication,ProviderError} from './publishers.mjs';

export async function runWorker({client=backend(),config=env,maxJobs=8,step=advancePublication}={}){
 if(!publishingOn(config))return {paused:true};
 let processed=0;const key=config('SMIT_TOKEN_ENCRYPTION_KEY'),started=Date.now();
 while(processed<maxJobs&&Date.now()-started<8*60000){
  const jobs=await checked(client.rpc('smit_claim_job'));if(!jobs?.length)break;const job=jobs[0];processed++;
  let progress={},sending=false;
  async function finish(status,remote_id=null,error=null,next=null){return checked(client.rpc('smit_job_finish',{p_id:job.id,p_lease:job.lease_id,p_status:status,p_progress:status==='published'?null:seal(progress,key,'job:'+job.id),p_remote:remote_id,p_error:error,p_next:next}));}
  try{
   if(job.progress_ciphertext)progress=unseal(job.progress_ciphertext,key,'job:'+job.id);
   if(Date.now()-Date.parse(job.scheduled_at)>2*3600000)throw new ProviderError('PRAZO_DE_PROCESSAMENTO',progress.phase==='confirm');
   const account=await checked(client.from('smit_accounts').select('*').eq('id',job.account_id).single());if(account.remote_id!==job.payload.remote_id||!accountReady(account,config))throw new ProviderError('PERMISSAO_DE_PUBLICACAO');
   const secret=await checked(client.from('smit_account_secrets').select('*').eq('account_id',account.id).single());let credential=unseal(secret.ciphertext,key,'account:'+account.id);
   const expiry=credential.expires_at||secret.expires_at;
   if(expiry&&Date.parse(expiry)<=Date.now()+120000){
    const provider={youtube:'GOOGLE',linkedin:'LINKEDIN'}[account.channel];if(!provider||!credential.refresh_token)throw new ProviderError('ACESSO_EXPIRADO');
    const response=await fetch(provider==='GOOGLE'?'https://oauth2.googleapis.com/token':'https://www.linkedin.com/oauth/v2/accessToken',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:config('SMIT_'+provider+'_CLIENT_ID'),client_secret:config('SMIT_'+provider+'_CLIENT_SECRET'),refresh_token:credential.refresh_token}),signal:AbortSignal.timeout(15000)});const fresh=await response.json();if(!response.ok||!fresh.access_token||!Number.isFinite(fresh.expires_in))throw new ProviderError('RECONECTAR_CONTA');credential={...credential,token:fresh.access_token,refresh_token:fresh.refresh_token||credential.refresh_token,expires_at:new Date(Date.now()+fresh.expires_in*1000).toISOString()};await checked(client.from('smit_account_secrets').update({ciphertext:seal(credential,key,'account:'+account.id),expires_at:credential.expires_at,updated_at:new Date().toISOString()}).eq('account_id',account.id));
   }
   const result=await step({payload:job.payload,progress,token:credential.token,config,scheduled_at:job.scheduled_at,
    mediaURL:async m=>(await checked(client.storage.from(bucket).createSignedUrl(m.object_path,3600))).signedUrl,
    checkpoint:async p=>{progress=p;const rows=await checked(client.from('smit_jobs').update({progress_ciphertext:seal(progress,key,'job:'+job.id),updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_id',job.lease_id).eq('status','claimed').select('id'));if(rows.length!==1)throw new ProviderError('RESERVA_EXPIRADA');},
    startSend:async()=>{if(!await checked(client.rpc('smit_job_sending',{p_id:job.id,p_lease:job.lease_id})))throw new ProviderError('RESERVA_EXPIRADA');sending=true;}
   });progress=result.progress;await finish(result.status,result.remote_id||null,null,result.next||null);
  }catch(e){
   const unknown=e.uncertain||sending&&!(e instanceof ProviderError);
   const status=unknown?'unknown':e instanceof ProviderError?'failed':'pending';
   await finish(status,progress.remote_id||progress.video||null,unknown?'O envio pode ter ocorrido. Confira a rede e não repita a publicação.':e instanceof ProviderError?e.message:'O serviço não respondeu antes do envio. A fila tentará novamente.',new Date(Date.now()+60000).toISOString());
  }
 }
 return {processed};
}
