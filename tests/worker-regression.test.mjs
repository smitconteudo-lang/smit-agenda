import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorker} from '../src/worker.mjs';
import {seal,unseal} from '../src/meta.mjs';
import {ProviderError} from '../src/publishers.mjs';

const key='ab'.repeat(32);
const settings={SMIT_TOKEN_ENCRYPTION_KEY:key,SMIT_SUPABASE_SECRET_KEY:'test-only',SMIT_GOOGLE_CLIENT_ID:'test-client',SMIT_GOOGLE_CLIENT_SECRET:'test-client-secret'};
const config=k=>settings[k];
function setup({channel='instagram',expired=false,refresh=false,scopes,age=0,count=1}={}){
 const secret={token:'old-test-token',expires_at:new Date(Date.now()+(expired?-3600000:3600000)).toISOString(),...(refresh?{refresh_token:'old-refresh'}:{})};
 const account={id:'account',remote_id:'123',channel,verified_at:'verified',scopes:scopes??[channel==='youtube'?'https://www.googleapis.com/auth/youtube.force-ssl':'instagram_content_publish']};
 const jobs=Array.from({length:count},(_,i)=>({id:'job-'+i,account_id:'account',lease_id:'lease-'+i,scheduled_at:new Date(Date.now()-age).toISOString(),payload:{channel,remote_id:'123'}}));
 const finished=[],updates=[],reads=[];let claims=0,sends=0;
 const client={rpc:async(name,args)=>{if(name==='smit_claim_job')return {data:jobs[claims++]?[jobs[claims-1]]:[]};if(name==='smit_job_sending'){sends++;return {data:true};}if(name==='smit_job_finish'){finished.push(args);return {data:true};}throw Error('Unexpected '+name);},from:table=>({select:()=>({eq:()=>({single:async()=>{reads.push(table);return {data:table==='smit_accounts'?account:{ciphertext:seal(secret,key,'account:account'),expires_at:secret.expires_at}};}})}),update:patch=>({eq:async()=>{updates.push(patch);return {data:true};}})})};
 return {client,finished,updates,reads,account,getClaims:()=>claims,getSends:()=>sends};
}
test('expired Instagram access stops the job before any provider step',async()=>{
 const h=setup({expired:true});let steps=0;await runWorker({client:h.client,config,step:async()=>{steps++;}});assert.equal(steps,0);assert.equal(h.finished[0].p_status,'failed');assert.match(h.finished[0].p_error,/ACESSO_EXPIRADO/);assert.equal(h.getSends(),0);
});
test('revoked publishing permission blocks work before reading the stored token',async()=>{
 const h=setup({scopes:[]});await runWorker({client:h.client,config,step:async()=>{throw Error('Must not publish');}});assert.deepEqual(h.reads,['smit_accounts']);assert.equal(h.finished[0].p_status,'failed');assert.equal(h.getSends(),0);
});
test('paused worker does not claim jobs or read credentials',async()=>{
 const h=setup();assert.deepEqual(await runWorker({client:h.client,config:k=>k==='SMIT_PUBLISHING_ENABLED'?'false':config(k)}),{paused:true});assert.equal(h.getClaims(),0);assert.equal(h.reads.length,0);
});
test('expired YouTube token is renewed, encrypted and used without exposing refresh tokens',async t=>{
 const h=setup({channel:'youtube',expired:true,refresh:true});let refreshes=0,steps=0;
 t.mock.method(globalThis,'fetch',async(u,o)=>{refreshes++;assert.equal(u,'https://oauth2.googleapis.com/token');assert.equal(new URLSearchParams(o.body).get('refresh_token'),'old-refresh');return Response.json({access_token:'new-test-token',refresh_token:'rotated-refresh',expires_in:3600});});
 await runWorker({client:h.client,config,step:async c=>{steps++;assert.equal(c.token,'new-test-token');await c.startSend();return {status:'published',progress:{},remote_id:'video-id'};}});
 assert.equal(refreshes,1);assert.equal(steps,1);assert.equal(h.finished[0].p_status,'published');assert.equal(h.updates.length,1);const stored=unseal(h.updates[0].ciphertext,key,'account:account');assert.equal(stored.refresh_token,'rotated-refresh');assert.equal(stored.token,'new-test-token');assert.ok(!JSON.stringify([...h.updates,...h.finished]).includes('new-test-token'));
});
test('Google rejection of token renewal requires reconnection without sending',async t=>{
 const h=setup({channel:'youtube',expired:true,refresh:true});t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid_grant'},{status:400}));
 await runWorker({client:h.client,config,step:async()=>{throw Error('Must not publish');}});assert.equal(h.finished[0].p_status,'failed');assert.match(h.finished[0].p_error,/RECONECTAR_CONTA/);assert.equal(h.getSends(),0);assert.equal(h.updates.length,0);
});
test('interrupted renewal before sending is retryable and does not mark a publication unknown',async t=>{
 const h=setup({channel:'youtube',expired:true,refresh:true});t.mock.method(globalThis,'fetch',async()=>{throw Error('network interruption');});await runWorker({client:h.client,config});assert.equal(h.finished[0].p_status,'pending');assert.equal(h.getSends(),0);assert.ok(Date.parse(h.finished[0].p_next)>Date.now());
});
test('overdue work is stopped rather than publishing hours after the scheduled time',async()=>{
 const h=setup({age:3*3600000});await runWorker({client:h.client,config});assert.equal(h.finished[0].p_status,'failed');assert.match(h.finished[0].p_error,/PRAZO_DE_PROCESSAMENTO/);assert.equal(h.reads.length,0);
});
test('a failed destination does not prevent the worker processing the next destination',async()=>{
 const h=setup({count:2});let steps=0;await runWorker({client:h.client,config,step:async c=>{if(++steps===1)throw new ProviderError('FORMAT_REJECTED');await c.startSend();return {status:'published',progress:{},remote_id:'confirmed-second'};}});assert.deepEqual(h.finished.map(x=>x.p_status),['failed','published']);assert.equal(h.getSends(),1);
});
test('batch limit leaves remaining jobs unclaimed for the next invocation',async()=>{
 const h=setup({count:3});await runWorker({client:h.client,config,maxJobs:1,step:async()=>({status:'pending',progress:{},next:new Date(Date.now()+30000).toISOString()})});assert.equal(h.getClaims(),1);assert.equal(h.finished.length,1);
});
test('interruption after the send fence persists unknown and never schedules an automatic resend',async()=>{
 const h=setup();await runWorker({client:h.client,config,step:async c=>{await c.startSend();throw Error('lost response');}});assert.equal(h.finished[0].p_status,'unknown');assert.equal(h.getSends(),1);assert.match(h.finished[0].p_error,/não repita/);
});
