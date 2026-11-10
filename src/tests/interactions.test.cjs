const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../viewer_core.js'),P=require('../viewer_print.js')(C,require('../viewer_exports.js')),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const event=(doc,type,values={})=>Object.assign(new doc.defaultView.Event(type,{bubbles:true,cancelable:true}),values);
function raw(n=1){
 const message=(role,value)=>({author:{role},content:{content_type:'text',parts:[value]}});
 return JSON.stringify(Array.from({length:n},(_,i)=>({id:String(i),title:'Chat '+i,current_node:'a',mapping:{q:{parent:null,message:message('user','Question')},a:{parent:'q',message:message('assistant','Answer')}}})));
}
async function load(a,n=1){await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw(n)])}]);return a.api.state.records[0]}
test('checkbox hit area, Shift range and count text follow multi-select mode',async()=>{
 const a=setup({editing:true}),d=a.document;await load(a,8);assert.equal(d.getElementById('selection-count').textContent,'共 8 个会话');d.getElementById('multi-toggle').click();assert.equal(d.getElementById('selection-count').textContent,'已选 0 / 8 项');
 const keys=[...a.api.state.visibleKeys],hits=[...d.querySelectorAll('.selection-hit')];hits[1].dispatchEvent(event(d,'click'));assert.equal(a.api.state.selected.size,1);
 d.querySelectorAll('.selection-hit')[6].dispatchEvent(event(d,'click',{shiftKey:true}));assert.equal(a.api.state.selected.size,6);for(const k of keys.slice(1,7))assert.ok(a.api.state.selected.has(k));
 d.getElementById('multi-toggle').click();assert.equal(a.api.state.selected.size,0);assert.equal(d.getElementById('selection-count').textContent,'共 8 个会话');
});
test('Shift selection spans unrendered items in current sorted/filtered list',async()=>{
 const a=setup({editing:true});await load(a,230);const keys=[...a.api.state.visibleKeys];a.api.selectRange(keys[2],true);a.api.selectRange(keys[225],true,true);assert.equal(a.api.state.selected.size,224);a.api.selectRange(keys[220],false,true);assert.equal(a.api.state.selected.size,5);
});
test('audit compares saved field values, multi-step history focuses the changed message',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw()}),opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);const r=a.api.state.records[0];
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'Edited title'}]);a.api.commit([{doc:r.doc,path:[0,'mapping','a','message','content','parts',0],value:'Edited answer'}]);assert.equal(a.api.audit.changes().length,2);
 assert.equal(a.document.getElementById('undo-steps').querySelectorAll('button').length,2);await a.api.saveWorkspace();assert.equal(a.api.audit.changes().length,0);
 await a.api.historyEdit('undo',2);assert.equal(r.raw.title,'Chat 0');assert.equal(r.raw.mapping.a.message.content.parts[0],'Answer');assert.equal(a.api.audit.changes().length,2);assert.equal(a.api.unsaved(),true);
 await a.api.historyEdit('redo',2);const article=[...a.document.querySelectorAll('#msgs article')].find(e=>e.dataset.node==='a');assert.equal(article.dataset.scrolled,'1');assert.equal(a.api.unsaved(),false);assert.equal(a.api.audit.changes().length,0);assert.ok(a.api.journal.pendingCount>0);assert.ok(!C.serialize(r.doc).includes('historyId'));
 a.api.showChanges();assert.equal(a.document.getElementById('history-dialog').open,true);assert.ok(a.document.getElementById('history-source').textContent.includes('archive'));
});
test('cancelled edits and download confirmation keep accurate saved checkpoints',async()=>{
 const a=setup({editing:true}),r=await load(a);a.api.commit([{doc:r.doc,path:[0,'title'],value:'B'}]);a.api.commit([{doc:r.doc,path:[0,'title'],value:'Chat 0'}]);assert.equal(a.api.audit.changes().length,0);assert.equal(a.api.unsaved(),false);assert.ok(a.api.journal.pendingCount>0);
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'download'}]);await a.api.saveAsChoice('zip');assert.ok(a.api.audit.changes().length);a.api.commit([{doc:r.doc,path:[0,'title'],value:'after download'}]);a.document.getElementById('confirm-download').click();assert.equal(a.api.audit.changes()[0].before,'download');assert.equal(a.api.audit.changes()[0].after,'after download');assert.equal(a.api.unsaved(),true);
});
test('undo navigation opens the other branch containing the affected message',async()=>{
 const a=setup({editing:true}),c=JSON.parse(raw())[0];c.mapping.b={parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['branch B']}}};await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([c])])}]);const r=a.api.state.records[0];a.api.commit([{doc:r.doc,path:[0,'mapping','b','message','content','parts',0],value:'edited B'}]);await a.api.historyEdit('undo');assert.equal(a.api.state.branches.get(r.key),'b');assert.ok(a.document.getElementById('msgs').textContent.includes('branch B'));
});
test('print uses the same role/panel/body hierarchy and retains palette without buttons',async()=>{
 const a=setup({editing:true}),r=await load(a),result=await P.build([r],{}, {document:a.document,resources:new Map(),branches:new Map(),palette:{'--bg-msg-user':'#f0f0f0','--bg-main':'#fff'},markdown(value){const div=a.document.createElement('div'),b=a.document.createElement('button');b.textContent='Copy';div.textContent=value;div.append(b);return div}});
 assert.equal(result.element.style.getPropertyValue('--bg-msg-user'),'#f0f0f0');assert.equal(result.element.querySelector('.msg.user .message-panel .msg-content').textContent,'Question');assert.equal(result.element.querySelectorAll('button').length,0);assert.ok(result.style.includes('background:var(--bg-msg-user)!important'));assert.ok(result.style.includes('print-color-adjust:exact'));
});
test('holding over successive ticks jumps to question starts without within-turn interpolation',async()=>{
 const a=setup({editing:true}),d=a.document,c=JSON.parse(raw())[0];for(let i=1;i<5;i++){c.mapping['q'+i]={parent:i===1?'a':'a'+(i-1),message:{author:{role:'user'},content:{content_type:'text',parts:['Q'+i]}}};c.mapping['a'+i]={parent:'q'+i,message:{author:{role:'assistant'},content:{content_type:'text',parts:['A'+i]}}}}c.current_node='a4';await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([c])])}]);
 const rail=d.getElementById('turn-outline'),scroller=d.getElementById('chat-container');rail.getBoundingClientRect=()=>({top:100,bottom:300,left:0,right:22});for(const [i,b]of [...d.querySelectorAll('#turn-marks button')].entries())b.getBoundingClientRect=()=>({top:100+i*40,bottom:140+i*40,left:0,right:22});scroller.getBoundingClientRect=()=>({top:0});Object.defineProperty(scroller,'scrollHeight',{value:1000});Object.defineProperty(scroller,'clientHeight',{value:200});
 for(const [i,article]of [...d.querySelectorAll('#msgs article')].entries())article.getBoundingClientRect=()=>({top:i*100-scroller.scrollTop});
 rail.dispatchEvent(event(d,'pointerdown',{button:0,pointerId:1,clientY:130}));assert.equal(scroller.scrollTop,0);
 rail.dispatchEvent(event(d,'pointermove',{pointerId:1,clientY:190}));assert.equal(scroller.scrollTop,400);
 rail.dispatchEvent(event(d,'pointermove',{pointerId:1,clientY:205}));assert.equal(scroller.scrollTop,400);rail.dispatchEvent(event(d,'pointerup',{pointerId:1,clientY:300}));assert.equal(scroller.scrollTop,400);assert.equal(a.api.unsaved(),false);
});
test('folder and ZIP Save As icons directly open distinct native pickers',async()=>{
 const a=setup({editing:true}),r=await load(a),folder=memoryFS({},'new folder'),zip=memoryFS({'copy.zip':''});let folders=0,zips=0;
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'direct save as'}]);a.ctx.showDirectoryPicker=async()=>{folders++;return folder.root};a.ctx.showSaveFilePicker=async()=>{zips++;return zip.file('copy.zip')};
 a.document.getElementById('save-as-workspace').click();for(let i=0;i<100&&a.api.state.source.kind!=='directory';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(folders,1);assert.equal(zips,0);assert.equal(a.document.getElementById('save-as-dialog'),null);assert.equal(JSON.parse(await folder.files.get('conversations.json').text())[0].title,'direct save as');
 a.document.getElementById('save-as-zip-workspace').click();for(let i=0;i<100&&a.api.state.source.kind!=='zip';i++)await new Promise(r=>setTimeout(r,5));assert.equal(zips,1);assert.equal(a.api.state.source.name,'copy.zip');assert.equal(a.api.unsaved(),false);
});
test('long-field comparisons show the actual changed area instead of the unchanged prefix',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw()}),opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);const r=a.api.state.records[0],prefix='unchanged '.repeat(500);a.api.commit([{doc:r.doc,path:[0,'mapping','a','message','content','parts',0],value:prefix+'OLD-END'}]);assert.equal(await a.api.saveWorkspace(),true);
 a.api.commit([{doc:r.doc,path:[0,'mapping','a','message','content','parts',0],value:prefix+'NEW-END'}]);a.api.showChanges();const preview=a.document.querySelector('#changes-list .change-value').textContent;assert.ok(preview.includes('OLD-END'));assert.ok(preview.includes('NEW-END'));assert.ok(a.document.querySelector('#changes-list details'));
});

test('selecting stars adds active starred chats across search filters and displays the selection total',async()=>{
 const a=setup({editing:true}),d=a.document,id=name=>d.getElementById(name);await load(a,4);
 const [first,second,third,fourth]=a.api.state.records;
 assert.equal(id('select-starred').disabled,true);
 for(const r of [first,third,fourth])a.api.toggleStar(r.key);
 a.api.deleteRecords([fourth.key]);id('search').value='Chat 1';await a.api.renderList();
 assert.equal(id('selection-count').textContent,'匹配 1 / 3 个会话');
 a.api.selectRange(second.key,true);id('select-starred').click();
 assert.deepEqual([...a.api.state.selected].sort(),[first.key,second.key,third.key].sort());
 assert.equal(id('selection-count').textContent,'已选 3 / 3 项');
 assert.equal(id('selection-tools').children.length,7);
 const corner=d.querySelector('.github-corner');
 assert.equal(corner.getAttribute('href'),'https://github.com/chchaoo/gpt-notebook');
 assert.ok(corner.parentElement.classList.contains('topbar'));
 assert.ok(corner.querySelector('.octo-arm'));
});
