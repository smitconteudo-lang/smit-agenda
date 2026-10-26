import test from 'node:test';
import assert from 'node:assert/strict';
import {accountReadiness,inspectDestinations} from '../src/readiness.mjs';
import {schedulingRoute} from '../src/scheduling.mjs';
import {metaRoute,seal} from '../src/meta.mjs';

const values={SMIT_SUPABASE_SECRET_KEY:'test',SMIT_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),SMIT_META_API_VERSION:'v99.0',SMIT_META_APP_SECRET:'test',SMIT_GOOGLE_CLIENT_ID:'test',SMIT_GOOGLE_CLIENT_SECRET:'test',SMIT_LINKEDIN_CLIENT_ID:'test',SMIT_LINKEDIN_CLIENT_SECRET:'test',SMIT_LINKEDIN_API_VERSION:'209901'};
const config=k=>values[k],ig={id:'00000000-0000-4000-8000-000000000001',channel:'instagram',remote_id:'123',name:'Official Instagram',verified_at:'2026-01-01',scopes:['instagram_content_publish']},fb={...ig,id:'00000000-0000-4000-8000-000000000002',channel:'facebook_page',name:'Official Facebook',scopes:['pages_read_engagement']};
const secret={account_id:ig.id,expires_at:'2099-01-01T00:00:00Z'},media={id:'00000000-0000-4000-8000-000000000003',status:'ready',mime:'image/jpeg',bytes:3,name:'image.jpg',object_path:'private/image.jpg'},post={id:'00000000-0000-4000-8000-000000000004',version:1,title:'Test',caption:'Caption',format:'Imagem',media_ids:[media.id]};

test('readiness separates identity, credentials, permission, expiry and server configuration',()=>{
 assert.equal(accountReadiness(ig,secret,config).publishing_enabled,true);
 assert.equal(accountReadiness(ig,null,config).publishing_enabled,false);
 assert.match(accountReadiness(ig,{expires_at:'2000-01-01'},config).connection_issues.join(),/expirado/);
 assert.equal(accountReadiness({...ig,verified_at:null},secret,config).publishing_enabled,false);
 assert.equal(accountReadiness(ig,secret,k=>k==='SMIT_PUBLISHING_ENABLED'?'false':config(k)).publishing_enabled,false);
 assert.match(accountReadiness(fb,secret,config).connection_issues.join(),/permissão de publicação/);
 assert.equal(accountReadiness(ig,secret,k=>k==='SMIT_META_APP_SECRET'?'':config(k)).publishing_enabled,false);
});
test('preflight collects account-specific issues and detects existing jobs and expiring access',()=>{
 const args={post,accounts:[ig,fb],media:[media],secrets:[secret,{...secret,account_id:fb.id}],at:new Date('2098-01-01'),config};
 const results=inspectDestinations(args);assert.equal(results[0].ok,true);assert.equal(results[1].ok,false);assert.equal(results[0].snapshot.media[0].object_path,media.object_path);
 assert.match(inspectDestinations({...args,jobs:[{status:'published'}]})[0].issues.join(),/já possui fila/);
 assert.equal(inspectDestinations({...args,jobs:[{status:'cancelled'}]})[0].ok,true);
 assert.match(inspectDestinations({...args,at:new Date('2100-01-01')})[0].issues.join(),/expira antes/);
 assert.match(inspectDestinations({...args,media:[{...media,mime:'image/png'}]})[0].issues.join(),/JPEG/);
});
function clientFixture(){const calls=[],tables={smit_posts:[{version:1,payload:post}],smit_accounts:[ig,fb],smit_media:[media],smit_account_secrets:[secret,{...secret,account_id:fb.id}],smit_jobs:[]};return {calls,client:{storage:{from:()=>({})},from:table=>{const filters=[];const chain={select:()=>chain,in:(k,v)=>{filters.push(r=>v.includes(r[k]));return chain;},eq:(k,v)=>{filters.push(r=>r[k]===v);return chain;},single:async()=>({data:tables[table].filter(r=>filters.every(f=>f(r)))[0]}),then:(resolve,reject)=>{calls.push({type:'read',table});return Promise.resolve({data:tables[table].filter(r=>filters.every(f=>f(r)))}).then(resolve,reject);}};if(table==='smit_posts')chain.eq=()=>chain;return chain;},rpc:async(name,args)=>{calls.push({type:'write',name,args});return {data:{scheduled:args.p_destinations.length}};}}};}
const when=()=>new Date(Date.now()+15*60000-3*3600000).toISOString().slice(0,16);
test('server simulation returns all selected account checks without RPC writes or provider calls',async()=>{
 const f=clientFixture(),r=await schedulingRoute({client:f.client,req:{method:'POST'},path:'/posts/'+post.id+'/simulate',body:{version:1,when:when(),account_ids:[ig.id,fb.id]},me:{id:'member'},env:config,json:Response.json}),data=await r.json();
 assert.equal(data.simulation,true);assert.equal(data.jobs_created,0);assert.equal(data.provider_calls,0);assert.equal(data.ok,false);assert.deepEqual(data.accounts.map(a=>a.ok),[true,false]);assert.equal(f.calls.filter(c=>c.type==='write').length,0);assert.ok(!JSON.stringify(data).includes('object_path'));assert.ok(!JSON.stringify(data).includes('snapshot'));
});
test('real scheduling rejects any blocked destination and freezes validated payload for ready accounts',async()=>{
 const f=clientFixture(),invoke=ids=>schedulingRoute({client:f.client,req:{method:'POST'},path:'/posts/'+post.id+'/schedule',body:{version:1,when:when(),account_ids:ids},me:{id:'member'},env:config,json:Response.json});await assert.rejects(()=>invoke([ig.id,fb.id]),/Official Facebook/);assert.equal(f.calls.filter(c=>c.type==='write').length,0);await invoke([ig.id]);const write=f.calls.find(c=>c.type==='write');assert.equal(write.name,'smit_schedule');assert.equal(write.args.p_destinations[0].payload.media[0].object_path,media.object_path);
});
test('simulation rejects stale versions and past times without changing the queue',async()=>{
 const f=clientFixture(),invoke=body=>schedulingRoute({client:f.client,req:{method:'POST'},path:'/posts/'+post.id+'/simulate',body,me:{id:'member'},env:config,json:Response.json});await assert.rejects(()=>invoke({version:2,when:when(),account_ids:[ig.id]}),/versão mudou/);await assert.rejects(()=>invoke({version:1,when:'2000-01-01T10:00',account_ids:[ig.id]}),/data entre/);assert.equal(f.calls.filter(c=>c.type==='write').length,0);
});
for(const valid of [true,false])test('Meta access verification '+(valid?'refreshes granted permissions':'invalidates revoked access'),async()=>{
 const updates=[],v={...values,SMIT_META_APP_ID:'123',SMIT_META_CONFIG_ID:'456',SMIT_BASE_URL:'https://smit.example',SMIT_SUPABASE_URL:'https://db.example'};
 const invoke=()=>metaRoute({req:{method:'POST'},path:'/accounts/'+ig.id+'/verify',url:new URL('https://smit.example'),body:{},me:{id:'member'},env:k=>v[k],json:Response.json,fetcher:async(u,o={})=>{const url=new URL(u);if(url.hostname==='db.example'){if(o.method==='PATCH'){updates.push(JSON.parse(o.body));return Response.json([]);}return Response.json(url.pathname.endsWith('smit_accounts')?[ig]:[{ciphertext:seal({token:'private-test'},v.SMIT_TOKEN_ENCRYPTION_KEY,'account:'+ig.id)}]);}if(url.pathname.endsWith('/debug_token'))return Response.json({data:{is_valid:valid,app_id:'123',scopes:['instagram_basic']}});return Response.json({id:'123',name:'Official Instagram'});}});
 if(valid){const data=await(await invoke()).json();assert.equal(data.permissions_checked,true);assert.deepEqual(updates[0].scopes,['instagram_basic']);assert.ok(updates[0].verified_at);}else{await assert.rejects(invoke,/Acesso inválido/);assert.deepEqual(updates[0],{verified_at:null});}
});
