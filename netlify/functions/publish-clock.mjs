import {createHmac} from 'node:crypto';
import {backend,checked,env,publishingOn} from '../../src/backend.mjs';
export default async function(){
 if(!publishingOn())return new Response('paused');
 const client=backend(),due=await checked(client.from('smit_jobs').select('id').in('status',['pending','claimed','sending','confirming']).lte('scheduled_at',new Date(Date.now()+600000).toISOString()).lte('next_attempt_at',new Date().toISOString()).limit(1));
 if(due.length){const stamp=String(Date.now()),signature=createHmac('sha256',env('SMIT_TOKEN_ENCRYPTION_KEY')).update('dispatch:'+stamp).digest('hex');const r=await fetch(env('SMIT_BASE_URL')+'/internal/publish-worker',{method:'POST',headers:{'X-SMIT-Time':stamp,'X-SMIT-Signature':signature},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});if(r.status!==202)throw Error('Worker not accepted');}
 return new Response('ok');
}
export const config={schedule:'* * * * *'};
