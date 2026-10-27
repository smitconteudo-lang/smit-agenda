import {createHmac} from 'node:crypto';

const env=k=>globalThis.Netlify?.env?.get(k)??process.env[k];

// The minute clock needs only one small REST read, not the database client SDK.
// The durable database lease and send fence remain in the background worker.
export async function runClock({config=env,fetcher=fetch,now=Date.now}={}){
 const key=config('SMIT_TOKEN_ENCRYPTION_KEY'),secret=config('SMIT_SUPABASE_SECRET_KEY');
 if(config('SMIT_PUBLISHING_ENABLED')==='false'||!key||!secret)return new Response('paused');
 const db=new URL('/rest/v1/smit_jobs',config('SMIT_SUPABASE_URL'));
 if(db.protocol!=='https:')throw Error('Database URL must use HTTPS');
 const at=now();db.search=new URLSearchParams({select:'id',status:'in.(pending,claimed,sending,confirming)',scheduled_at:'lte.'+new Date(at+600000).toISOString(),next_attempt_at:'lte.'+new Date(at).toISOString(),limit:'1'}).toString();
 const response=await fetcher(db,{headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Queue check not confirmed');
 const due=await response.json();
 if(!Array.isArray(due)||due.length>1||due.some(j=>!j||typeof j.id!=='string'||!j.id))throw Error('Invalid queue response');
 if(due.length){
  const worker=new URL('/internal/publish-worker',config('SMIT_BASE_URL'));
  if(worker.protocol!=='https:')throw Error('Worker URL must use HTTPS');
  const stamp=String(now()),signature=createHmac('sha256',key).update('dispatch:'+stamp).digest('hex');
  const r=await fetcher(worker,{method:'POST',headers:{'X-SMIT-Time':stamp,'X-SMIT-Signature':signature},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(r.status!==202)throw Error('Worker not accepted');
 }
 return new Response('ok');
}
export default async function(){return runClock();}
export const config={schedule:'* * * * *'};
