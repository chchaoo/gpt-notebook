const {test}=require('node:test'),assert=require('node:assert/strict'),O=require('../viewer_outline.js'),{setup}=require('./dom_checks.cjs');
function chat(n=5){const mapping={};for(let i=0;i<n;i++){mapping['q'+i]={parent:i?'a'+(i-1):null,message:{author:{role:'user'},content:{content_type:'text',parts:['question '+i]}}};mapping['a'+i]={parent:'q'+i,message:{author:{role:'assistant'},content:{content_type:'text',parts:['answer '+i]}}}}return {title:'outline test',id:'outline',current_node:'a'+(n-1),mapping}}
async function load(a,n=5){const c=chat(n);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([c])])}]);return a.api.state.records[0]}
const plain=m=>m.content.parts?.filter(x=>typeof x==='string').join(' ')||'';
test('turn grouping includes answer previews and preserves all node references',()=>{
 const c=chat(3),rows=O.turns({raw:c},Object.keys(c.mapping),plain);assert.equal(rows.length,3);assert.equal(rows[1].question,'question 1');assert.equal(rows[1].answer,'answer 1');assert.deepEqual(rows[1].nodes,['q1','a1']);
 const only=O.turns({raw:c},['a0','a1','a2'],plain);assert.equal(only.length,3);assert.equal(only[2].node,'a2');assert.ok(!O.excerpt('😀'.repeat(140),120).includes('\uFFFD'));
});
test('quick jump loads a turn beyond the 40-message preview batch',async()=>{
 const a=setup(),r=await load(a,60),outline=a.api.turnOutline;assert.equal(outline.getRows().length,60);assert.equal(a.document.querySelectorAll('#msgs article').length,40);
 const scroller=a.document.getElementById('chat-container');scroller.getBoundingClientRect=()=>({top:40});const pending=a.api.jumpToTurn(outline.getRows()[55],r.key);
 for(const [i,el]of [...a.document.querySelectorAll('#msgs article')].entries())el.getBoundingClientRect=()=>({top:40+i*100-scroller.scrollTop});
 await pending;assert.ok(a.document.querySelectorAll('#msgs article').length>=112);
 assert.equal(scroller.scrollTop,11000);assert.equal(outline.getActive(),55);assert.equal(a.api.unsaved(),false);
});
test('preview is inert text and is excluded from language translation',async()=>{
 const a=setup(),r=await load(a,3);a.api.commit([{doc:r.doc,path:[0,'mapping','q1','message','content','parts',0],value:'文件 <img src=x onerror=alert(1)>'}]);
 const outline=a.api.turnOutline;outline.show(1);const preview=a.document.getElementById('turn-preview');assert.equal(preview.hidden,false);assert.ok(preview.textContent.includes('<img'));assert.equal(preview.querySelectorAll('img').length,0);
 const before=preview.textContent;a.ctx.ViewerI18n.setLanguage('en');assert.equal(preview.textContent,before);outline.hide();assert.equal(preview.hidden,true);
});
test('active turn follows scroll positions without moving chat scroll',async()=>{
 const a=setup();await load(a,5);const scroller=a.document.getElementById('chat-container');scroller.getBoundingClientRect=()=>({top:20,height:500});
 for(const [i,article]of [...a.document.querySelectorAll('#msgs article')].entries())article.getBoundingClientRect=()=>({top:20+i*150-scroller.scrollTop});
 scroller.scrollTop=620;a.api.turnOutline.refresh();a.api.turnOutline.update();assert.equal(a.api.turnOutline.getActive(),2);assert.equal(scroller.scrollTop,620);
 assert.equal(a.document.querySelector('#turn-marks [aria-current="location"]').dataset.node,'q2');
});
test('navigation visibility and stale source guard do not change documents',async()=>{
 const a=setup();await load(a,3);const before=a.api.state.docs[0].text;a.api.turnOutline.setEnabled(false);assert.equal(a.document.getElementById('turn-outline').hidden,true);
 a.api.turnOutline.setEnabled(true);assert.equal(a.document.getElementById('turn-outline').hidden,false);await a.api.jumpToTurn(a.api.turnOutline.getRows()[1],'another-source');assert.equal(a.api.state.docs[0].text,before);assert.equal(a.api.unsaved(),false);
 await load(a,1);assert.equal(a.document.getElementById('turn-outline').hidden,true);
});
