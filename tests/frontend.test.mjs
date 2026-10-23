import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
test('seis telas, texto seguro e planejamento direto sem aprovação',async()=>{
 const html=readFileSync('public/index.html','utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 const dom=new JSDOM(html.replace(/<script>[\s\S]*?<\/script>/g,''),{url:'file:///smit/index.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.fetch=()=>{throw Error('A prévia local não pode chamar APIs');};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};w.URL.createObjectURL=()=> 'blob:mock';w.URL.revokeObjectURL=()=>{};
 try{
  scripts.forEach((script,i)=>w.eval(script+(i===scripts.length-1?'\nwindow.__qa={openEditor,openPost,openPlan,getData:()=>DATA,getRoutes:()=>routes};':'')));
  assert.match(w.document.querySelector('#view').textContent,/próxima publicação/);
  for(const r of Object.keys(w.__qa.getRoutes())){w.location.hash=r;await new Promise(r=>setTimeout(r,10));assert.ok(w.document.querySelector('#page-title').textContent);if(r==='accounts'){assert.equal(w.document.querySelectorAll('.connect-provider').length,4);assert.match(w.document.querySelector('#view').textContent,/Conectar uma conta não publica conteúdo/);const button=w.document.querySelector('[data-provider="google"]');button.click();assert.match(w.document.querySelector('#modal').textContent,/YouTube Data API/);w.document.querySelector('#modal').close();}if(r==='metrics')assert.equal(w.document.querySelector('#collect-metrics').disabled,true);}
  assert.equal(w.__qa.getData().accounts.length,0);
  w.__qa.openEditor();const f=w.document.querySelector('#editor');f.elements.title.value='<img src=x onerror=alert(1)>';f.elements.caption.value='Legenda SMIT';f.querySelector('[name="destination"][value="instagram"]').checked=true;f.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));
  const p=w.__qa.getData().posts[0];assert.equal(p.destinations[0],'instagram');assert.equal(p.status,'draft');w.__qa.openPost(p.id);assert.equal(w.document.querySelector('#detail-approve'),null);assert.equal(w.document.querySelector('#detail-plan').disabled,false);assert.equal(w.document.querySelector('#modal img'),null);
  w.__qa.openPlan(p);const plan=w.document.querySelector('#plan-form');plan.elements.when.value='2099-10-22T10:30';plan.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));assert.equal(p.status,'planned');assert.equal(p.planned_local,'2099-10-22T10:30');
 }finally{w.close();}
});
