const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs'),{readHistory}=require('./history_store.cjs');
const Store=require('../viewer_journal_store.js');
const raw=JSON.stringify([{id:'one',title:'A',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['hello']}}}}}]);
async function open(a,fs){const x=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records[0]}
function edit(a,r,title){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:title}])}
function pause(a,method='saveDirectory'){
 const io=a.ctx.ViewerStorage,original=io[method];let resume,entered;const gate=new Promise(r=>resume=r),ready=new Promise(r=>entered=r);
 io[method]=async(...args)=>{entered(args);await gate;return original(...args)};
 return {ready,resume,restore:()=>io[method]=original};
}
const diskTitle=async fs=>JSON.parse(await fs.files.get('conversations.json').text())[0].title;

test('save writes its checkpoint while later edits remain dirty and the next save keeps both history steps',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw,'chat.html':'<html><script>var jsonData = '+raw+';</script></html>'}),r=await open(a,fs);edit(a,r,'B');const gate=pause(a),saving=a.api.saveWorkspace();await gate.ready;
 assert.equal(a.document.getElementById('save-workspace').disabled,true);assert.equal(a.document.getElementById('edit-title').disabled,false);edit(a,r,'C');assert.equal(r.raw.title,'C');assert.equal(await a.api.saveWorkspace(),false);gate.resume();assert.equal(await saving,true);gate.restore();
 assert.equal(await diskTitle(fs),'B');assert.ok((await fs.files.get('chat.html').text()).includes('"title":"B"'));assert.equal(r.raw.title,'C');assert.equal(a.api.unsaved(),true);assert.equal(a.api.journal.pendingCount,1);assert.equal(a.api.audit.changes()[0].before,'B');assert.equal(a.api.audit.changes()[0].after,'C');
 assert.equal(await a.api.saveWorkspace(),true);assert.equal(await diskTitle(fs),'C');assert.equal(a.api.unsaved(),false);const b=setup(),row=await open(b,fs),versions=b.api.journal.data.records[row.historyUid].versions;assert.deepEqual(Array.from(versions,v=>JSON.parse(b.api.journal.target(row.historyUid,v.id)).title),['A','B']);
});

test('an editor opened during saving keeps its unapplied draft and remains available after commit',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');const gate=pause(a),saving=a.api.saveWorkspace();await gate.ready;
 a.document.getElementById('edit-title').click();const input=a.document.querySelector('#edit-fields textarea');assert.ok(input);input.value='C';input.dispatchEvent(new a.document.defaultView.Event('input'));gate.resume();await saving;gate.restore();
 assert.equal(await diskTitle(fs),'B');assert.equal(a.document.getElementById('editor').open,true);assert.equal(input.value,'C');assert.equal(a.api.unsaved(),true);a.document.getElementById('save-edit').onclick();assert.equal(r.raw.title,'C');assert.equal(a.api.unsaved(),true);
});

test('undo during writing changes the live draft, never the checkpoint being written',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');const gate=pause(a),saving=a.api.saveWorkspace();await gate.ready;assert.equal(a.document.getElementById('undo').disabled,false);await a.api.historyEdit('undo');assert.equal(r.raw.title,'A');gate.resume();await saving;gate.restore();
 assert.equal(await diskTitle(fs),'B');assert.equal(a.api.unsaved(),true);assert.equal(await a.api.saveWorkspace(),true);assert.equal(await diskTitle(fs),'A');assert.equal(a.api.unsaved(),false);
});

test('failed save retains newer edits and both pending operations for retry',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');const gate=pause(a),saving=a.api.saveWorkspace();await gate.ready;edit(a,r,'C');fs.control.fail=(phase,p)=>phase==='close'&&p==='conversations.json'?new Error('disk error'):null;gate.resume();assert.equal(await saving,false);gate.restore();
 assert.equal(await diskTitle(fs),'A');assert.equal(r.raw.title,'C');assert.equal(a.api.journal.pendingCount,2);fs.control.fail=null;assert.equal(await a.api.saveWorkspace(),true);assert.equal(await diskTitle(fs),'C');const logical=await readHistory(fs);assert.equal(logical.records[r.historyUid].versions.length,1);
});

test('ordinary saves append exactly one batch and never read, hash or rewrite older batches',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const first=[...fs.files.keys()].find(Store.managed),blob=fs.files.get(first),bytes=await blob.text();
 const file=fs.root.getDirectoryHandle.bind(fs.root);fs.root.getDirectoryHandle=async(...args)=>{const dir=await file(...args);if(args[0]==='.viewer-backups'){const child=dir.getDirectoryHandle.bind(dir);dir.getDirectoryHandle=async(...args)=>{const segments=await child(...args);if(args[0]==='segments'){const get=segments.getFileHandle.bind(segments);segments.getFileHandle=async(name,...rest)=>{if('.viewer-backups/segments/'+name===first)throw Error('old segment was accessed');return get(name,...rest)}}return segments}}return dir};
 const start=fs.calls.length;edit(a,r,'C');assert.equal(await a.api.saveWorkspace(),true);assert.equal(fs.files.get(first),blob);assert.equal(await fs.files.get(first).text(),bytes);const added=fs.calls.slice(start).filter(([phase,p])=>phase==='close'&&Store.managed(p));assert.equal(added.length,1);assert.notEqual(added[0][1],first);const batch=JSON.parse(await fs.files.get(added[0][1]).text());assert.equal(batch.changes.records[r.historyUid].versions.length,1);assert.equal(batch.previous,first);assert.equal(JSON.parse(await fs.files.get(Store.path).text()).records,undefined);
});

test('cleanup preserves separate surviving batches and physically removes the replaced suffix',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);for(const value of ['B','C','D']){edit(a,r,value);await a.api.saveWorkspace()}const old=[...fs.files.keys()].filter(Store.managed),versions=a.api.journal.data.records[r.historyUid].versions;
 await a.api.deleteBackup('edit',r.historyUid,versions[1].id);assert.equal(await a.api.saveWorkspace(),true);for(const path of old)assert.equal(fs.files.has(path),false);assert.equal([...fs.files.keys()].filter(Store.managed).length,2);const b=setup(),row=await open(b,fs),kept=b.api.journal.data.records[row.historyUid].versions;assert.deepEqual(Array.from(kept,v=>JSON.parse(b.api.journal.target(row.historyUid,v.id)).title),['A','C']);
});

test('disabling backup removes all delta batches; re-enabling starts from current content',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;await a.api.saveWorkspace();assert.equal([...fs.files.keys()].some(Store.managed),false);assert.equal(JSON.parse(await fs.files.get(Store.path).text()).head,null);
 edit(a,r,'C');await a.api.saveWorkspace();assert.equal([...fs.files.keys()].some(Store.managed),false);a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;edit(a,r,'D');await a.api.saveWorkspace();const b=setup(),row=await open(b,fs),v=b.api.journal.data.records[row.historyUid].versions;assert.equal(v.length,1);assert.equal(JSON.parse(b.api.journal.target(row.historyUid,v[0].id)).title,'C');
});

test('missing or cyclic batches block save instead of silently discarding history',async()=>{
 for(const cyclic of [false,true]){const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const path=[...fs.files.keys()].find(Store.managed);if(cyclic){const batch=JSON.parse(await fs.files.get(path).text());batch.previous=path;fs.files.set(path,new Blob([JSON.stringify(batch)]))}else fs.files.delete(path);const b=setup();await open(b,fs);assert.ok(b.api.state.journalProblem);assert.equal(await b.api.saveWorkspace(),false);assert.equal(await diskTitle(fs),'B')}
});

test('Legacy aggregate history migrates once, then later saves leave its converted batch untouched',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const logical=await readHistory(fs);fs.files.set(Store.path,new Blob([JSON.stringify(logical)]));for(const path of [...fs.files.keys()].filter(Store.managed))fs.files.delete(path);
 const b=setup(),row=await open(b,fs);edit(b,row,'C');await b.api.saveWorkspace();assert.equal(JSON.parse(await fs.files.get(Store.path).text()).version,143);const path=[...fs.files.keys()].find(Store.managed),blob=fs.files.get(path);edit(b,row,'D');await b.api.saveWorkspace();assert.equal(fs.files.get(path),blob);assert.equal((await readHistory(fs)).records[row.historyUid].versions.length,3);
});

test('Save As ZIP also freezes its checkpoint and retains edits made while choosing the target',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),target=memoryFS({'new.zip':''}),r=await open(a,fs);edit(a,r,'B');let ready,resume;const entered=new Promise(r=>ready=r),gate=new Promise(r=>resume=r);a.ctx.showSaveFilePicker=async()=>{ready();await gate;return target.file('new.zip')};const saving=a.api.saveAsChoice('zip');await entered;edit(a,r,'C');resume();assert.equal(await saving,true);assert.equal(a.api.unsaved(),true);
 const zip=await require('../vendor/jszip/jszip.min.js').loadAsync(await target.files.get('new.zip').arrayBuffer());assert.equal(JSON.parse(await zip.file('conversations.json').async('string'))[0].title,'B');assert.equal(r.raw.title,'C');assert.equal(a.api.journal.pendingCount,1);
});

test('portable HTML uses the checkpoint even when newer edits arrive while its original bytes are being read',async()=>{
 const html='<style>unchanged style</style><script id="data" type="application/json">'+JSON.stringify({version:2,sources:[{path:'conversations.json',text:raw}],archive:[]})+'</script>',a=setup(),fs=memoryFS({'conversations.json':raw,'chat.html':html}),r=await open(a,fs);edit(a,r,'B');let announce,resume;const ready=new Promise(r=>announce=r),gate=new Promise(r=>resume=r);
 class PausedBlob extends Blob{async arrayBuffer(){announce();await gate;return super.arrayBuffer()}}
 a.api.state.entries.set('chat.html',{path:'chat.html',blob:new PausedBlob([html])});const saving=a.api.saveWorkspace();await ready;edit(a,r,'C');resume();assert.equal(await saving,true);const saved=await fs.files.get('chat.html').text();assert.ok(saved.startsWith('<style>unchanged style</style>'));const payload=JSON.parse(saved.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.equal(JSON.parse(payload.sources[0].text)[0].title,'B');assert.equal(await diskTitle(fs),'B');assert.equal(r.raw.title,'C');assert.equal(a.api.unsaved(),true);
});

test('failed history cleanup restores the previous index and batches without advancing the in-memory baseline',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);for(const value of ['B','C']){edit(a,r,value);await a.api.saveWorkspace()}const before=new Map(await Promise.all([...fs.files].map(async([p,b])=>[p,await b.text()]))),paths=[...fs.files.keys()].filter(Store.managed),version=a.api.journal.data.records[r.historyUid].versions[0].id;let once=true;fs.control.fail=(phase,p)=>phase==='remove'&&p===paths[1]&&once?(once=false,new Error('locked history')):null;
 assert.equal(await a.api.deleteBackup('edit',r.historyUid,version),false);assert.deepEqual([...fs.files.keys()].sort(),[...before.keys()].sort());for(const [p,text]of before)assert.equal(await fs.files.get(p).text(),text);assert.equal(a.api.unsaved(),false);fs.control.fail=null;assert.equal(await a.api.deleteBackup('edit',r.historyUid,version),true);const logical=await readHistory(fs);assert.equal(logical.records[r.historyUid].versions.length,1);
});

test('saving before close keeps the document open when new edits arrive during writing',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');a.api.requestClose();const gate=pause(a),completed=new Promise(resolve=>{const original=a.api.state;const timer=setInterval(()=>{if(!original.busy&&original.saving===false){clearInterval(timer);resolve()}},2)});a.document.getElementById('leave-save').click();await gate.ready;edit(a,r,'C');a.document.getElementById('leave-discard').click();assert.equal(a.api.state.docs.length,1);gate.resume();await completed;gate.restore();assert.equal(await diskTitle(fs),'B');assert.equal(a.api.state.docs.length,1);assert.equal(a.api.state.records[0].raw.title,'C');assert.equal(a.api.unsaved(),true);assert.equal(a.document.getElementById('leave-dialog').open,true);
});

test('a no-op history cleanup does not rewrite or recreate existing batches',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const before=new Map(fs.files),start=fs.calls.length;a.api.journal.purge(()=>false);assert.equal(a.api.unsaved(),false);await a.api.saveWorkspace();assert.equal(fs.calls.length,start);for(const [p,b]of before)assert.equal(fs.files.get(p),b);
});

test('the persisted checksum detects a valid-JSON modification to a batch when reopening',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r,'B');await a.api.saveWorkspace();const path=[...fs.files.keys()].find(Store.managed),batch=JSON.parse(await fs.files.get(path).text());batch.changes.records[r.historyUid].meta.title='changed outside';fs.files.set(path,new Blob([JSON.stringify(batch)]));const b=setup();await open(b,fs);assert.ok(b.api.state.journalProblem);assert.equal(await b.api.saveWorkspace(),false);
});
