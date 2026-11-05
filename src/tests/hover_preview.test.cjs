const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs');
const event=(d,name)=>new d.defaultView.Event(name,{bubbles:false});
test('hover previews update synchronously across marks and gaps, without clicking or moving the chat',async()=>{
 const a=setup(),d=a.document;let node=null,mapping={};for(let i=0;i<4;i++){mapping['q'+i]={parent:node,message:{author:{role:'user'},content:{content_type:'text',parts:['Question '+i]}}};mapping['a'+i]={parent:'q'+i,message:{author:{role:'assistant'},content:{content_type:'text',parts:['Answer '+i]}}};node='a'+i}await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([{id:'hover',title:'Hover',current_node:node,mapping}])])}]);const marks=[...d.querySelectorAll('.turn-mark')],preview=d.getElementById('turn-preview'),container=d.getElementById('chat-container');container.scrollTop=321;
 marks[2].dispatchEvent(event(d,'pointerenter'));assert.equal(preview.hidden,false);assert.ok(preview.textContent.includes('Question 2'));
 marks[2].dispatchEvent(event(d,'pointerleave'));assert.equal(preview.hidden,false);
 marks[3].dispatchEvent(event(d,'pointerenter'));assert.ok(preview.textContent.includes('Question 3'));assert.equal(preview.hidden,false);
 marks[1].dispatchEvent(event(d,'pointerenter'));assert.ok(preview.textContent.includes('Question 1'));assert.equal(d.querySelectorAll('[aria-describedby="turn-preview"]').length,1);assert.equal(container.scrollTop,321);assert.equal(a.api.unsaved(),false);
 d.getElementById('turn-outline').dispatchEvent(event(d,'mouseleave'));assert.equal(preview.hidden,true);
});
