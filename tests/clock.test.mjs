import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {runClock,config as clockConfig} from '../netlify/functions/publish-clock.mjs';
const values={SMIT_TOKEN_ENCRYPTION_KEY:'test-only',SMIT_SUPABASE_SECRET_KEY:'sb_secret_test',SMIT_SUPABASE_URL:'https://db.example',SMIT_BASE_URL:'https://app.example'};
const config=k=>values[k],now=()=>1800000000000;
test('clock uses one bounded read on an empty queue and never invokes worker',async()=>{
 let calls=0;
 const r=await runClock({config,now,fetcher:async(u,o)=>{calls++;assert.equal(new URL(u).origin,'https://db.example');assert.equal(new URL(u).searchParams.get('limit'),'1');assert.equal(new URL(u).searchParams.get('select'),'id');assert.equal(new URL(u).searchParams.get('scheduled_at'),'lte.'+new Date(now()+600000).toISOString());assert.equal(o.redirect,'error');assert.equal(o.headers.apikey,'sb_secret_test');assert.equal(o.headers.Authorization,undefined);return Response.json([]);}});
 assert.equal(await r.text(),'ok');assert.equal(calls,1);assert.equal(clockConfig.schedule,'* * * * *');
});
test('clock starts signed worker only when actionable jobs exist',async()=>{
 let calls=0;
 await runClock({config,now,fetcher:async(u,o)=>{if(++calls===1)return Response.json([{id:'job'}]);assert.equal(String(u),'https://app.example/internal/publish-worker');assert.equal(o.method,'POST');assert.equal(o.headers['X-SMIT-Time'],String(now()));assert.equal(o.headers['X-SMIT-Signature'],createHmac('sha256',values.SMIT_TOKEN_ENCRYPTION_KEY).update('dispatch:'+now()).digest('hex'));assert.equal(o.headers.apikey,undefined);return new Response(null,{status:202});}});assert.equal(calls,2);
});
test('disabled clock does not access the database',async()=>{assert.equal(await (await runClock({config:k=>k==='SMIT_PUBLISHING_ENABLED'?'false':config(k),fetcher:()=>{throw Error('No calls allowed');}})).text(),'paused');});
test('queue errors and malformed responses never dispatch a worker',async()=>{
 for(const response of [new Response('error',{status:503}),Response.json({error:'bad'}),Response.json([{}])]){let calls=0;await assert.rejects(()=>runClock({config,now,fetcher:async()=>{calls++;return response;}}),/Queue check|Invalid queue/);assert.equal(calls,1);}
});
test('worker rejection remains an error rather than a successful tick',async()=>{let calls=0;await assert.rejects(()=>runClock({config,now,fetcher:async()=>++calls===1?Response.json([{id:'job'}]):new Response(null,{status:500})}),/Worker not accepted/);});
