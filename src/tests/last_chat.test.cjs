const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const row=id=>({id,title:'Title '+id,current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['Private body']}}}}});
function env(store=new Map()){const a=setup();a.ctx.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};return a}
async function open(a,data,name='archive'){const fs=memoryFS({'conversations.json':JSON.stringify(data)},name),opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);return fs}
const select=(a,id)=>a.api.selectRecord(a.api.state.records.find(r=>r.id===id).key);
test('reopening automatically restores last selected chat and position without a URL fragment or file changes',async()=>{
 const store=new Map(),data=[row('a'),row('b'),row('c')],a=env(store);await open(a,data);select(a,'b');a.document.getElementById('chat-container').scrollTop=765;a.api.requestClose();const b=env(store),fs=await open(b,data);assert.equal(b.api.state.records.find(r=>r.key===b.api.state.current).id,'b');assert.equal(b.document.getElementById('chat-container').scrollTop,765);assert.equal(b.api.unsaved(),false);assert.equal(fs.calls.length,0);assert.deepEqual([...fs.files.keys()],['conversations.json']);
});
test('selection is recorded immediately even when the user never scrolls or closes normally',async()=>{
 const store=new Map(),data=[row('a'),row('b')],a=env(store);await open(a,data);select(a,'b');const b=env(store);await open(b,data);assert.equal(b.api.state.records.find(r=>r.key===b.api.state.current).id,'b');
});
test('last chat restores by stable ID after record indices change; missing last chat safely falls back',async()=>{
 const store=new Map(),a=env(store);await open(a,[row('a'),row('b'),row('c')]);select(a,'b');a.document.getElementById('chat-container').scrollTop=432;a.api.requestClose();const b=env(store);await open(b,[row('b'),row('c'),row('a')]);assert.equal(b.api.state.records.find(r=>r.key===b.api.state.current).id,'b');assert.equal(b.document.getElementById('chat-container').scrollTop,432);const c=env(store);await open(c,[row('a'),row('c')]);assert.ok(c.api.state.records.some(r=>r.key===c.api.state.current));assert.equal(c.api.unsaved(),false);
});
test('sources stay independent and an explicit valid chat link takes precedence',async()=>{
 const store=new Map(),data=[row('a'),row('b')],a=env(store);await open(a,data);select(a,'b');const b=env(store);await open(b,data,'other archive');assert.equal(b.api.state.records.find(r=>r.key===b.api.state.current).id,'a');const c=env(store);c.ctx.location.hash='#a';await open(c,data);assert.equal(c.api.state.records.find(r=>r.key===c.api.state.current).id,'a');
});
test('last selected chat beyond the first sidebar batch is loaded and highlighted on reopening',async()=>{
 const store=new Map(),data=Array.from({length:230},(_,i)=>row(String(i).padStart(3,'0'))),a=env(store);await open(a,data);const target=a.api.state.records.find(r=>r.key===a.api.state.visibleKeys.at(-1)).id;select(a,target);const b=env(store);await open(b,data);assert.equal(b.api.state.records.find(r=>r.key===b.api.state.current).id,target);assert.ok(b.document.querySelector('.conv-item.active'));assert.ok(b.document.querySelectorAll('.conv-item').length>200);
});
test('last selected branch returns along with its chat and reading position',async()=>{
 const store=new Map(),first=row('a');first.mapping.r={parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['Other answer']}}};const data=[first,row('b')],a=env(store);await open(a,data);select(a,'a');const d=a.document;d.getElementById('branch').value='r';d.getElementById('branch').dispatchEvent(new d.defaultView.Event('change'));d.getElementById('chat-container').scrollTop=333;a.api.requestClose();const b=env(store);await open(b,data);assert.equal(b.document.getElementById('branch').value,'r');assert.equal(b.document.getElementById('chat-container').scrollTop,333);
});
