const {test}=require('node:test'),assert=require('node:assert/strict'),O=require('../viewer_outline.js'),{setup}=require('./dom_checks.cjs');
const event=(d,type,values={})=>Object.assign(new d.defaultView.Event(type,{bubbles:true,cancelable:true}),values);
function railFixture(){
 const a=setup(),d=a.document,rail=d.getElementById('turn-outline'),marks=d.getElementById('turn-marks'),preview=d.getElementById('turn-preview'),calls=[];
 const view={addEventListener(){}};const o=O.create({document:d,rail,marks,preview,scroller:d.getElementById('chat-container'),region:d.getElementById('reading-region'),content:d.getElementById('msgs'),view,onJump:(...args)=>calls.push(args)});
 o.set({key:'record'},Array.from({length:4},(_,i)=>({node:'q'+i,nodes:['q'+i],question:'Question '+i,answer:'Answer '+i})));
 rail.getBoundingClientRect=()=>({top:100,bottom:250,left:10,right:32});
 const boxes=[[120,130],[135,155],[180,190],[210,230]];
 for(const [i,b]of [...marks.children].entries())b.getBoundingClientRect=()=>({top:boxes[i][0],bottom:boxes[i][1],left:10,right:32});
 const send=(type,y,x=20,pointerId=1)=>rail.dispatchEvent(event(d,type,{button:0,pointerId,clientX:x,clientY:y}));
 return {...a,rail,marks,preview,calls,o,send};
}
test('held pointer chooses actual tick rectangles, once per tick, with no fractional scroll argument',()=>{
 const a=railFixture();a.send('pointerdown',125);assert.equal(a.calls[0][0].node,'q0');assert.equal(a.calls[0].length,2);
 a.send('pointermove',128);assert.equal(a.calls.length,1);a.send('pointermove',145);assert.equal(a.calls.at(-1)[0].node,'q1');
 a.send('pointermove',185);assert.equal(a.calls.at(-1)[0].node,'q2');a.send('pointermove',125);assert.equal(a.calls.at(-1)[0].node,'q0');
 a.send('pointerup',125);a.send('pointermove',220);assert.equal(a.calls.length,4);
});
test('gaps and movement outside the rail do not clamp to a turn; cancellation and unrelated pointers are ignored',()=>{
 const a=railFixture();a.send('pointerdown',105);assert.equal(a.calls.length,0);a.send('pointerdown',125);
 a.send('pointermove',160);a.send('pointermove',300);a.send('pointermove',220,100);a.send('pointermove',220,20,2);assert.equal(a.calls.length,1);
 a.send('pointercancel',125,20,2);a.send('pointermove',220);assert.equal(a.calls.length,2);
 a.send('pointercancel',220);a.send('pointermove',185);assert.equal(a.calls.length,2);
});
test('hover preview does not jump; keyboard/programmatic activation still jumps to the selected question',async()=>{
 const a=railFixture(),b=a.marks.children[2];b.dispatchEvent(event(a.document,'pointerenter'));
 await new Promise(r=>setTimeout(r,160));assert.equal(a.preview.hidden,false);assert.ok(a.preview.textContent.includes('Question 2'));assert.equal(a.calls.length,0);
 b.dispatchEvent(event(a.document,'click',{detail:0}));assert.equal(a.calls[0][0].node,'q2');
});
test('release click does not repeat the jump; disabling or switching records ends a held gesture',()=>{
 const a=railFixture();a.send('pointerdown',125);a.send('pointerup',125);a.marks.children[0].dispatchEvent(event(a.document,'click',{detail:1}));assert.equal(a.calls.length,1);
 a.send('pointerdown',145);a.o.setEnabled(false);a.send('pointermove',220);assert.equal(a.calls.length,2);
 a.o.setEnabled(true);a.send('pointerdown',185);a.o.set(null,[]);a.send('pointermove',220);assert.equal(a.calls.length,3);
});
test('a rapid new choice wins over an earlier request that had to load more messages',async()=>{
 const a=setup(),mapping={};for(let i=0;i<60;i++){for(const [role,id,parent]of [['user','q'+i,i?'a'+(i-1):null],['assistant','a'+i,'q'+i]])mapping[id]={parent,message:{author:{role},content:{content_type:'text',parts:[id]}}}}
 await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([{id:'long',title:'long',current_node:'a59',mapping}])])}]);
 const rows=a.api.turnOutline.getRows(),r=a.api.state.records[0],s=a.document.getElementById('chat-container');s.getBoundingClientRect=()=>({top:50});
 const earlier=a.api.jumpToTurn(rows[55],r.key);
 for(const [i,el]of [...a.document.querySelectorAll('#msgs article')].entries())el.getBoundingClientRect=()=>({top:50+i*100-s.scrollTop});
 await a.api.jumpToTurn(rows[2],r.key);await earlier;assert.equal(s.scrollTop,400);assert.equal(a.api.turnOutline.getActive(),2);assert.equal(a.api.unsaved(),false);
});
