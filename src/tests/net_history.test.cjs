const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs'),{readHistory,historyText}=require('./history_store.cjs');
const Store=require('../viewer_journal_store.js');
const raw=JSON.stringify([{id:'one',title:'abc',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['body']}}}}},{id:'two',title:'second',mapping:{}}]);
async function open(a,fs){const x=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records.find(r=>r.id==='one')}
function edit(a,r,value,path=['title']){a.api.commit([{doc:r.doc,path:[r.index,...path],value}])}
const versions=(a,r)=>a.api.journal.data.records[r.historyUid]?.versions||[];

test('one save cancels overlapping edits and stores only the baseline-to-final text delta',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'axc');edit(a,r,'abcd');assert.equal(await a.api.saveWorkspace(),true);const v=versions(a,r);assert.equal(v.length,1);assert.equal(JSON.parse(a.api.journal.target(r.historyUid,v[0].id)).title,'abc');assert.equal((await historyText(fs)).includes('axc'),false);assert.deepEqual(Array.from(v[0].delta.ops[0].edits,h=>({remove:h.remove,insert:h.insert})),[{remove:'d',insert:''}]);assert.equal(a.api.state.undo.length,2);
 const b=setup({editing:true}),row=await open(b,fs);assert.equal(versions(b,row).length,1);assert.equal(JSON.parse(b.api.journal.target(row.historyUid,versions(b,row)[0].id)).title,'abc');
});

test('typing back to the original creates no backup or writes, but in-memory undo remains usable',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'ac');edit(a,r,'abc');assert.equal(a.api.unsaved(),false);const start=fs.calls.length;await a.api.saveWorkspace();assert.equal(fs.calls.length,start);assert.equal([...fs.files.keys()].some(p=>p.startsWith('.viewer-backups/')),false);assert.equal(a.api.state.undo.length,2);await a.api.historyEdit('undo');assert.equal(r.raw.title,'ac');assert.equal(a.api.unsaved(),true);await a.api.saveWorkspace();assert.equal(versions(a,r).length,1);assert.equal(JSON.parse(a.api.journal.target(r.historyUid,versions(a,r)[0].id)).title,'abc');
});

test('folded-back fields are omitted while another changed field gets exactly one net operation',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'temporary title');edit(a,r,'body changed',['mapping','q','message','content','parts',0]);edit(a,r,'abc');await a.api.saveWorkspace();const v=versions(a,r);assert.equal(v.length,1);assert.equal(v[0].delta.ops.length,1);assert.deepEqual(Array.from(v[0].delta.ops[0].path),['mapping','q','message','content','parts',0]);assert.equal((await historyText(fs)).includes('temporary title'),false);
});

test('an edit followed by a saved deletion backs up the previously saved content, excluding the unsaved intermediate text',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'temporary unsaved');a.api.deleteRecords([r.key]);await a.api.saveWorkspace();assert.equal(versions(a,r).length,1);assert.equal(versions(a,r)[0].kind,'delete');assert.equal((await historyText(fs)).includes('temporary unsaved'),false);assert.equal(JSON.parse(a.api.journal.target(r.historyUid)).title,'abc');const b=setup({editing:true});await open(b,fs);await b.api.restoreBackup('deleted',r.historyUid,null);assert.equal(b.api.state.records.find(x=>x.historyUid===r.historyUid).raw.title,'abc');
});

test('delete-and-undo plus order-and-undo produce no net persistent history',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);a.api.deleteRecords([r.key]);await a.api.historyEdit('undo');const other=a.api.state.records.find(x=>x.id==='two');a.api.moveRecord(other.key,r.key);await a.api.historyEdit('undo');assert.equal(a.api.unsaved(),false);const start=fs.calls.length;await a.api.saveWorkspace();assert.equal(fs.calls.length,start);assert.equal(versions(a,r).length,0);assert.equal(a.api.journal.data.orders.length,0);
});

test('edits that fold back to the in-flight checkpoint become clean after that checkpoint commits',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');let announce,resume;const ready=new Promise(r=>announce=r),gate=new Promise(r=>resume=r),io=a.ctx.ViewerStorage,original=io.saveDirectory;io.saveDirectory=async(...args)=>{announce();await gate;return original(...args)};const saving=a.api.saveWorkspace();await ready;edit(a,r,'C');edit(a,r,'B');resume();await saving;io.saveDirectory=original;assert.equal(a.api.unsaved(),false);assert.equal(versions(a,r).length,1);const count=[...fs.files.keys()].filter(Store.managed).length,start=fs.calls.length;await a.api.saveWorkspace();assert.equal(fs.calls.length,start);assert.equal([...fs.files.keys()].filter(Store.managed).length,count);
});

test('a failed checkpoint does not create a boundary; returning to the last successful state needs no backup',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');fs.control.fail=(phase,p)=>phase==='close'&&p==='conversations.json'?new Error('disk error'):null;assert.equal(await a.api.saveWorkspace(),false);fs.control.fail=null;edit(a,r,'abc');assert.equal(a.api.unsaved(),false);const start=fs.calls.length;await a.api.saveWorkspace();assert.equal(fs.calls.length,start);assert.equal([...fs.files.keys()].some(Store.managed),false);assert.equal(await fs.files.get('conversations.json').text(),raw);
});

test('existing saved checkpoints remain unchanged and subsequent saves append only one net checkpoint',async()=>{
 const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const old=new Map([...fs.files].filter(([p])=>Store.managed(p)));const b=setup({editing:true}),row=await open(b,fs);edit(b,row,'temporary');edit(b,row,'C');await b.api.saveWorkspace();const data=await readHistory(fs);assert.equal(data.records[row.historyUid].versions.length,2);for(const [p,blob]of old)assert.equal(fs.files.get(p),blob);assert.equal((await historyText(fs)).includes('temporary'),false);assert.deepEqual(Array.from(versions(b,row),v=>JSON.parse(b.api.journal.target(row.historyUid,v.id)).title),['abc','B']);
});
