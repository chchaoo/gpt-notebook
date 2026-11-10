const {test}=require('node:test'),assert=require('node:assert/strict'),N=require('../viewer_navigation.js'),Factory=require('../viewer_editor.js'),{setup}=require('./dom_checks.cjs');
test('source lookup disambiguates repeated text by reading position and supports multiple text fields',()=>{
 const text=('重复段落 abc\n').repeat(100);const anchor=N.locateText([text],'重复段落',.8,3);assert.ok(anchor.offset>text.length*.7);assert.equal(anchor.offset%9,3);
 const match=N.locateText([{value:'first part'},{value:'second 😀 paragraph target'}],'😀 paragraph',.7,3);assert.equal(match.field,1);assert.equal(match.offset,10);
 assert.deepEqual(N.locateText(['abc','def'],'absent',1),{field:1,offset:3});
});
test('rich editor opens a collapsed source caret at the corresponding line without changing text',()=>{
 let selected;class Fake{constructor(o){this.text=o.initialValue.trim()}getMarkdown(){return this.text}setSelection(a,b){selected=[a,b]}destroy(){}}
 const root={toastui:{Editor:Fake},ViewerNavigation:N},original='\n\n# Heading\n\n'+Array.from({length:90},(_,i)=>'line '+i+' 😀').join('\n');const e=Factory(root).create({},original,()=>{});const offset=original.indexOf('line 65');e.seek(offset);assert.deepEqual(selected[0],[68,1]);assert.deepEqual(selected[0],selected[1]);assert.equal(e.get(),original);
});
test('opening a long user message maps the viewport text into a scrolled textarea, preserving chat scroll and draft state',async()=>{
 const a=setup({editing:true}),d=a.document,value=Array.from({length:100},(_,i)=>'paragraph '+i+' unique words').join('\n\n');await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([{id:'anchor',title:'Long',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:[value]}}}}}])])}]);const r=a.api.state.records[0],body=d.querySelector('.msg-content'),node=[...body.querySelectorAll('p')][50].firstChild,container=d.getElementById('chat-container');container.scrollTop=2600;container.getBoundingClientRect=()=>({top:50,bottom:650});body.getBoundingClientRect=()=>({top:-2000,bottom:5000,height:7000,left:100,width:600});d.caretPositionFromPoint=()=>({offsetNode:node,offset:5});
 const create=d.createElement.bind(d);d.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='textarea'){el.scrollHeight=10000;el.clientHeight=300;el.setSelectionRange=(start,end)=>{el.selectionStart=start;el.selectionEnd=end}}return el};
 a.api.editMessage(r,'q',r.raw.mapping.q.message);const input=d.querySelector('#edit-fields textarea');assert.equal(d.getElementById('editor').open,true);assert.equal(input.selectionStart,value.indexOf('paragraph 50')+5);assert.equal(input.selectionStart,input.selectionEnd);assert.ok(input.scrollTop>0);assert.equal(input.value,value);assert.equal(container.scrollTop,2600);assert.equal(a.api.unsaved(),false);
});
