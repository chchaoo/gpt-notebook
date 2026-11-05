const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs');
const raw=JSON.stringify([{id:'paper',title:'纸张输出',current_node:'a',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['我的问题']}}},a:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['正文\n\n```js\nconst value = 1;\n```']}}}}}]);
test('Print and PDF prepare identical paper content across all themes without changing the selected screen theme',async()=>{
 const a=setup(),d=a.document;await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])}]);let printed=0,reference;a.ctx.print=()=>printed++;
 // The paper path must not capture the current screen's dark/colored palette.
 a.ctx.getComputedStyle=()=>{throw Error('unexpected screen palette lookup')};
 for(const theme of ['light','dark','sepia','forest','rose','midnight','contrast','system']){
  d.getElementById('theme').value=theme;d.getElementById('theme').dispatchEvent(new d.defaultView.Event('change'));const selected=d.body.dataset.theme;
  for(const id of ['quick-print','quick-pdf']){
   d.getElementById(id).click();assert.equal(d.getElementById('print-dialog').open,true);const before=printed;await a.api.startPrint();assert.equal(printed,before+1);const page=d.getElementById('print-document');assert.ok(page);assert.ok(page.textContent.includes('我的问题'));assert.equal(page.querySelectorAll('button').length,0);assert.equal(page.style.getPropertyValue('--bg-main')||'','');assert.equal(d.body.dataset.theme,selected);reference??=page.outerHTML;assert.equal(page.outerHTML,reference,theme+' / '+id);
  }
 }
 assert.equal(printed,16);
});
