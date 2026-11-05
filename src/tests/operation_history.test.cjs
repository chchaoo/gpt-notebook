const {readHistory,historyText}=require('./history_store.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const raw=JSON.stringify(['A','other'].map(id=>({id,title:id,current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:[id==='A'?'body':'UNCHANGED-LARGE-CONTENT']}}}}})));
async function open(a,fs){const data=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(data.entries,null,data.source)}
function edit(a,value,path=['title']){const r=a.api.state.records.find(r=>r.id==='A');a.api.commit([{doc:r.doc,path:[r.index,...path],value}]);return r}
const titles=(a,uid)=>Array.from(a.api.journal.data.records[uid].versions,v=>{const raw=a.api.journal.target(uid,v.id);return raw===null?null:JSON.parse(raw).title});

test('all edits, undo and redo before one Save coalesce to one net checkpoint',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'B');edit(a,'C');a.api.historyEdit('undo');a.api.historyEdit('redo');assert.equal(await a.api.saveWorkspace(),true);assert.deepEqual(titles(a,r.historyUid),['A']);
 const b=setup();await open(b,fs);assert.deepEqual(titles(b,b.api.state.records[0].historyUid),['A']);
});
test('a net-zero edit-and-undo creates no persistent history and performs no writes',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'B');a.api.historyEdit('undo');const start=fs.calls.length;assert.equal(a.api.unsaved(),false);assert.equal(await a.api.saveWorkspace(),true);assert.equal(a.api.journal.has(r.historyUid),false);assert.equal(fs.calls.length,start);assert.equal(await fs.files.get('conversations.json').text(),raw);
});
test('normal edits store only changed tokens and no whole live record or frozen baseline',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'B');await a.api.saveWorkspace();const text=await historyText(fs),data=await readHistory(fs);assert.equal(text.includes('UNCHANGED-LARGE-CONTENT'),false);assert.equal(text.includes('"anchors"'),false);assert.equal(text.includes('"segments"'),false);assert.equal(text.includes('"raw"'),false);assert.equal(data.records[r.historyUid].versions[0].delta.ops[0].op,'text');assert.equal(a.api.journal.base.records[0].raw,undefined);
});
test('deletion, undo and redo collapse to a deletion of the previous saved content',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'B'),uid=r.historyUid;a.api.deleteRecords([r.key]);a.api.historyEdit('undo');a.api.historyEdit('redo');assert.equal(await a.api.saveWorkspace(),true);const b=setup();await open(b,fs);assert.deepEqual(titles(b,uid),['A']);await b.api.restoreBackup('deleted',uid,null);assert.equal(b.api.state.records.find(r=>r.historyUid===uid).raw.title,'A');await b.api.saveWorkspace();const c=setup();await open(c,fs);assert.deepEqual(titles(c,uid),['A',null]);
});
test('one-shot disable confirmation clears versions, deleted contents, order history and pending changes',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);edit(a,'B');await a.api.saveWorkspace();edit(a,'C');a.ctx.confirm=()=>false;a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;assert.equal(a.api.journal.data.enabled,true);assert.equal(Object.keys(a.api.journal.data.records).length,1);a.ctx.confirm=()=>true;a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;assert.equal(a.api.journal.data.enabled,false);assert.equal(Object.keys(a.api.journal.data.records).length,0);assert.equal(a.api.journal.data.orders.length,0);assert.equal(await a.api.saveWorkspace(),true);const b=setup();await open(b,fs);assert.equal(b.api.journal.data.enabled,false);edit(b,'D');await b.api.saveWorkspace();assert.equal(Object.keys(b.api.journal.data.records).length,0);b.document.getElementById('backup-toggle').click();await b.api.state.backupTask;edit(b,'E');await b.api.saveWorkspace();assert.deepEqual(titles(b,b.api.state.records[0].historyUid),['D']);
});
test('manual reordering, undo and redo preserve only the final net order checkpoint',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const [r,s]=a.api.state.records;a.api.moveRecord(s.key,r.key);a.api.historyEdit('undo');a.api.historyEdit('redo');await a.api.saveWorkspace();assert.equal(a.api.journal.data.orders.length,1);const histories=a.api.journal.data.orders.map(v=>Array.from(a.api.journal.orderTarget(v.id)));assert.deepEqual(Array.from(histories),[[r.historyUid,s.historyUid]]);
});
test('sort mode changes are undoable and stored as order-setting deltas',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);a.document.getElementById('sort-order').value='title';a.document.getElementById('sort-order').dispatchEvent(new a.document.defaultView.Event('change'));await a.api.saveWorkspace();assert.equal(a.api.journal.data.orders.length,1);const first=a.api.journal.data.orders[0];assert.equal(a.api.journal.orderStateTarget(first.id).sort,'updated');a.api.historyEdit('undo');assert.equal(a.api.state.sort,'updated');await a.api.saveWorkspace();assert.equal(a.api.journal.data.orders.length,2);
});
test('changed body text and inserted Markdown image content are included in operation deltas',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'body ![photo](data:image/png;base64,aGVsbG8=)',['mapping','q','message','content','parts',0]);await a.api.saveWorkspace();const ledger=await historyText(fs);assert.ok(ledger.includes('aGVsbG8='));const restored=JSON.parse(a.api.journal.target(r.historyUid,a.api.journal.data.records[r.historyUid].versions[0].id));assert.equal(restored.mapping.q.message.content.parts[0],'body');
});
test('only files that may be overwritten are checked; unchanged media remains untouched',async()=>{
 const fs=memoryFS({'conversations.json':raw,'media/x.bin':'asset'}),a=setup();await open(a,fs);const directory=fs.root.getDirectoryHandle.bind(fs.root);fs.root.getDirectoryHandle=async(name,options)=>{if(name==='media')throw Error('untouched media directory access');return directory(name,options)};edit(a,'B');assert.equal(await a.api.saveWorkspace(),true);assert.equal(await fs.files.get('media/x.bin').text(),'asset');
});
test('same-sized external target modifications still prevent overwrite',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);edit(a,'B');fs.files.set('conversations.json',new Blob([raw.replace('"A"','"Z"')]));assert.equal(await a.api.saveWorkspace(),false);assert.ok((await fs.files.get('conversations.json').text()).includes('"Z"'));
});
test('partial write failure rebuilds prior JSON from existing input and saved edits, then retry works',async()=>{
 const fs=memoryFS({'conversations.json':raw,'chat.html':'<script>var jsonData = '+raw+';</script>'}),a=setup();await open(a,fs);edit(a,'B');await a.api.saveWorkspace();const saved=await fs.files.get('conversations.json').text(),history=await fs.files.get('.viewer-state/viewer-history.json').text();edit(a,'C');let once=true;fs.control.fail=(phase,path)=>phase==='close'&&path==='chat.html'&&once?(once=false,new Error('disk full')):null;assert.equal(await a.api.saveWorkspace(),false);assert.equal(await fs.files.get('conversations.json').text(),saved);assert.equal(await fs.files.get('.viewer-state/viewer-history.json').text(),history);assert.equal(await a.api.saveWorkspace(),true);
});

test('multiple deleted conversations restore in their original file and manual display positions',async()=>{
 const data=JSON.stringify(['A','B','C'].map(id=>({id,title:id,mapping:{}}))),fs=memoryFS({'conversations.json':data}),a=setup();await open(a,fs);const [r,b,c]=a.api.state.records;a.api.moveRecord(c.key,r.key);await a.api.saveWorkspace();const uids=a.api.state.records.map(r=>r.historyUid);a.api.deleteRecords([r.key,b.key]);await a.api.saveWorkspace();const fresh=setup();await open(fresh,fs);await fresh.api.restoreBackup('deleted',uids[1],null);await fresh.api.saveWorkspace();assert.deepEqual(JSON.parse(await fs.files.get('conversations.json').text()).map(r=>r.id),['B','C']);await fresh.api.restoreBackup('deleted',uids[0],null);await fresh.api.saveWorkspace();assert.deepEqual(JSON.parse(await fs.files.get('conversations.json').text()).map(r=>r.id),['A','B','C']);assert.deepEqual(Array.from(fresh.api.orderedRecords(),r=>r.id),['C','A','B']);
});

test('download confirmation keeps later operation steps pending instead of losing them',async()=>{
 const a=setup();await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])}]);const r=edit(a,'B');await a.api.saveAsChoice('zip');const downloaded=a.downloads.at(-1).blob;edit(a,'C');a.document.getElementById('confirm-download').click();assert.equal(a.api.unsaved(),true);assert.equal(a.api.journal.pendingCount,1);const fs=memoryFS({'source.zip':await downloaded.arrayBuffer()});a.ctx.showOpenFilePicker=async()=>[fs.file('source.zip')];assert.equal(await a.api.saveWorkspace(),true);assert.deepEqual(titles(a,r.historyUid),['A','B']);
});
test('clearing saved history keeps only the unsaved net change for the next Save',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);edit(a,'B');await a.api.saveWorkspace();edit(a,'C');await a.api.showBackups();a.document.getElementById('backup-clean-all').click();await a.api.state.backupTask;await new Promise(r=>setTimeout(r,1));assert.equal(await a.api.saveWorkspace(),true);assert.equal(a.api.journal.data.enabled,true);assert.deepEqual(titles(a,a.api.state.records[0].historyUid),['B']);edit(a,'D');await a.api.saveWorkspace();assert.deepEqual(titles(a,a.api.state.records[0].historyUid),['B','C']);
});

test('structural history restores exact large-number tokens even when JavaScript rounds them equally',async()=>{
 const before='{"id":"A","title":"A","mapping":{},"large":9007199254740992}',after=before.replace('9007199254740992','9007199254740993'),fs=memoryFS({'conversations.json':'['+before+']'}),a=setup();await open(a,fs);const original=a.api.state.records[0],doc=a.ctx.ViewerCore.document('['+after+']');doc.path='conversations.json';const r={...original,doc,raw:doc.data[0]};a.api.state.docs=[doc];a.api.state.records=[r];a.api.journal.recordRaw(r,before,after);await a.api.saveWorkspace();const version=a.api.journal.data.records[r.historyUid].versions[0];await a.api.restoreBackup('edit',r.historyUid,version.id);await a.api.saveWorkspace();assert.ok((await fs.files.get('conversations.json').text()).includes('9007199254740992'));assert.equal((await fs.files.get('conversations.json').text()).includes('9007199254740993'),false);
});

test('removing a deletion checkpoint still lets the deleted-item entry find a remaining restorable state',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup();await open(a,fs);const r=edit(a,'B'),uid=r.historyUid;await a.api.saveWorkspace();a.api.deleteRecords([r.key]);a.api.historyEdit('undo');a.api.historyEdit('redo');await a.api.saveWorkspace();const last=a.api.journal.data.records[uid].versions.at(-1).id;a.api.journal.purge(v=>v.id===last);assert.equal(JSON.parse(a.api.journal.target(uid)).title,'A');await a.api.saveWorkspace();const b=setup();await open(b,fs);await b.api.restoreBackup('deleted',uid,null);assert.equal(b.api.state.records.find(r=>r.historyUid===uid).raw.title,'A');
});

test('ZIP target is checked again after compression before any overwrite',async()=>{
 const a=setup(),IO=a.ctx.ViewerStorage,blob=await IO.zipBlob(null,[{path:'conversations.json',blob:new Blob([raw])}]),fs=memoryFS({'source.zip':await blob.arrayBuffer()}),opened=await IO.zip(await fs.file('source.zip').getFile(),fs.file('source.zip'));let changed=false;
 await assert.rejects(IO.saveZip(opened.source,opened.entries,fs.file('source.zip'),false,phase=>{if(phase==='压缩 ZIP'&&!changed){changed=true;fs.files.set('source.zip',new Blob(['external']))}}),/其他程序/);assert.equal(await fs.files.get('source.zip').text(),'external');
});
