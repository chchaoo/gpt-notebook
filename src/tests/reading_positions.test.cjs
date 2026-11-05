const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const record=(id,count=1)=>{let parent=null;const mapping={};for(let i=0;i<count;i++){const node=id+'-q'+i;mapping[node]={parent,message:{author:{role:'user'},content:{content_type:'text',parts:['PRIVATE TEXT '+i]}}};parent=node}return {id,title:'PRIVATE TITLE '+id,current_node:parent,mapping}};
function env(store=new Map(),blocked=false){const a=setup();a.ctx.localStorage={getItem:key=>store.get(key)||null,setItem(key,value){if(blocked)throw Error('storage blocked');store.set(key,value)}};return a}
async function open(a,data,name='archive'){const fs=memoryFS({'conversations.json':JSON.stringify(data)},name),opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);return fs}
const select=(a,i)=>a.api.selectRecord(a.api.state.records[i].key);
test('switching conversations restores independent positions without editing files or marking the workspace dirty',async()=>{
 const store=new Map(),a=env(store),fs=await open(a,[record('a'),record('b')]),d=a.document,c=d.getElementById('chat-container');select(a,0);c.scrollTop=620;select(a,1);assert.equal(c.scrollTop,0);c.scrollTop=150;select(a,0);assert.equal(c.scrollTop,620);select(a,1);assert.equal(c.scrollTop,150);assert.equal(a.api.unsaved(),false);assert.deepEqual([...fs.files.keys()],['conversations.json']);assert.equal(fs.calls.length,0);const saved=store.get('viewer-reading-positions-v1');assert.ok(saved);assert.equal(saved.includes('PRIVATE'),false);
});
test('browser-local records survive reopening the same source and remain separate from other sources',async()=>{
 const store=new Map(),data=[record('a'),record('b')],a=env(store);await open(a,data);select(a,0);a.document.getElementById('chat-container').scrollTop=745;select(a,1);const b=env(store);await open(b,data);select(b,0);assert.equal(b.document.getElementById('chat-container').scrollTop,745);const other=env(store);await open(other,data,'different archive');select(other,0);assert.equal(other.document.getElementById('chat-container').scrollTop,0);
});
test('restoring a deep conversation also restores enough lazily loaded messages after reopening',async()=>{
 const store=new Map(),data=[record('long',90),record('short')],a=env(store);await open(a,data);select(a,0);a.document.querySelector('#msgs .load-more').click();assert.equal(a.document.querySelectorAll('#msgs article').length,80);a.document.getElementById('chat-container').scrollTop=1900;select(a,1);const b=env(store);await open(b,data);select(b,0);assert.equal(b.document.querySelectorAll('#msgs article').length,80);assert.equal(b.document.getElementById('chat-container').scrollTop,1900);
});
test('duplicate conversation IDs do not overwrite each other’s reading positions',async()=>{
 const a=env();await open(a,[record('same'),record('same')]);select(a,0);a.document.getElementById('chat-container').scrollTop=450;select(a,1);a.document.getElementById('chat-container').scrollTop=880;select(a,0);assert.equal(a.document.getElementById('chat-container').scrollTop,450);select(a,1);assert.equal(a.document.getElementById('chat-container').scrollTop,880);
});
test('storage failure or corrupt local records never prevent viewing or switching chats',async()=>{
 for(const corrupt of [false,true]){const store=new Map([['viewer-reading-positions-v1','{broken']]),a=env(store,!corrupt);await open(a,[record('a'),record('b')]);select(a,0);a.document.getElementById('chat-container').scrollTop=555;select(a,1);select(a,0);assert.equal(a.document.getElementById('chat-container').scrollTop,555);assert.equal(a.api.unsaved(),false)}
});
test('late font restoration respects a later conversation switch and active user scrolling',async()=>{
 const a=env();await open(a,[record('a'),record('b')]);const d=a.document,c=d.getElementById('chat-container');select(a,0);c.scrollTop=620;select(a,1);c.scrollTop=150;let finish;d.fonts={ready:new Promise(resolve=>finish=resolve)};select(a,0);select(a,1);c.dispatchEvent(new d.defaultView.Event('wheel'));c.scrollTop=444;finish();await Promise.resolve();assert.equal(c.scrollTop,444);
});
test('a stable visible paragraph anchor survives layout reflow on return',async()=>{
 const a=env();await open(a,[record('a'),record('b')]);const d=a.document,c=d.getElementById('chat-container');let base=1000;c.getBoundingClientRect=()=>({top:0,bottom:500,height:500});const proto=d.defaultView.HTMLElement.prototype,original=proto.getBoundingClientRect;proto.getBoundingClientRect=function(){const article=this.closest('article[data-node]');if(article?.dataset.node==='a-q0')return {top:base-c.scrollTop,bottom:base-c.scrollTop+800,height:800};return {top:3000,bottom:3100,height:100}};try{select(a,0);c.scrollTop=1100;select(a,1);base=1600;select(a,0);assert.equal(c.scrollTop,1700)}finally{if(original)proto.getBoundingClientRect=original;else delete proto.getBoundingClientRect}
});

test('two branches of one conversation keep distinct browser-only positions',async()=>{
 const row={id:'branch',title:'Branches',current_node:'a',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['Question']}}},a:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['Answer A']}}},b:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['Answer B']}}}}},a=env();await open(a,[row]);const d=a.document,c=d.getElementById('chat-container'),branch=d.getElementById('branch');c.scrollTop=350;branch.value='b';branch.dispatchEvent(new d.defaultView.Event('change'));assert.equal(c.scrollTop,0);c.scrollTop=800;branch.value='a';branch.dispatchEvent(new d.defaultView.Event('change'));assert.equal(c.scrollTop,350);branch.value='b';branch.dispatchEvent(new d.defaultView.Event('change'));assert.equal(c.scrollTop,800);assert.equal(a.api.unsaved(),false);
});
