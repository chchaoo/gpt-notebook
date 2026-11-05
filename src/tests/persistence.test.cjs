const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const raw=JSON.stringify(['one','two'].map((id,i)=>({id,title:id,current_node:'n',mapping:{n:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['message '+i]}}}}})));
async function open(a,fs){const opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);return a.api.state.records}
test('normal app saves write only deltas, no new old-file snapshots, and failed writes do not advance history',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs),r=rows[0];a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'edited'}]);assert.equal(await a.api.saveWorkspace(),true);
 assert.ok(fs.files.has('.viewer-state/viewer-history.json'));assert.deepEqual([...fs.files.keys()].filter(p=>p.startsWith('.viewer-state/')).sort(),['.viewer-state/viewer-history.json','.viewer-state/viewer-settings.json']);assert.equal(a.api.journal.has(r.historyUid),true);assert.ok(a.document.querySelector('.conversation-history'));
 const saved=await fs.files.get('.viewer-state/viewer-history.json').text();a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'failure'}]);fs.control.fail=(phase,path)=>phase==='write'&&path==='conversations.json'?new Error('failed'):null;assert.equal(await a.api.saveWorkspace(),false);assert.equal(await fs.files.get('.viewer-state/viewer-history.json').text(),saved);assert.equal(a.api.unsaved(),true);
});
test('conversation version icon is beside its menu; restore is a draft and can be undone',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs),r=rows[0];a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'later'}]);await a.api.saveWorkspace();
 const icon=a.document.querySelector('.conversation-history');assert.ok(icon.nextElementSibling.classList.contains('conversation-menu'));
 const version=a.api.journal.data.records[r.historyUid].versions[0];await a.api.restoreBackup('edit',r.historyUid,version.id);assert.equal(r.raw.title,'one');assert.equal(a.api.unsaved(),true);await a.api.historyEdit('undo');assert.equal(r.raw.title,'later');
});
test('saved deletion survives closing/reopen, restores full record and supports structural undo/redo',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs),r=rows[0],uid=r.historyUid;a.api.deleteRecords([r.key]);assert.equal(await a.api.saveWorkspace(),true);
 const b=setup();await open(b,fs);assert.equal(b.api.state.records.length,1);await b.api.restoreBackup('deleted',uid,null);assert.equal(b.api.orderedRecords().length,2);assert.equal(b.api.unsaved(),true);
 await b.api.historyEdit('undo');assert.equal(b.api.orderedRecords().length,1);await b.api.historyEdit('redo');assert.equal(b.api.orderedRecords().length,2);assert.equal(await b.api.saveWorkspace(),true);
 const c=setup();await open(c,fs);assert.equal(c.api.state.records.length,2);assert.equal(c.api.journal.data.records[uid].deleted,undefined);
});
test('even deleting every conversation can reopen the archive and restore a tombstone',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs),uid=rows[0].historyUid;a.api.deleteRecords(rows.map(r=>r.key));assert.equal(await a.api.saveWorkspace(),true);
 const b=setup();await open(b,fs);assert.equal(b.api.state.records.length,0);assert.equal(b.document.getElementById('app').hidden,false);await b.api.restoreBackup('deleted',uid,null);assert.equal(b.api.orderedRecords().length,1);
});
test('backup category and age cleanup, global switch and order restoration persist on saving',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs);a.api.moveRecord(rows[1].key,rows[0].key);await a.api.saveWorkspace();assert.equal(a.api.journal.data.orders.length,1);
 const version=a.api.journal.data.orders[0];await a.api.restoreBackup('order',null,version.id);assert.equal(a.api.orderedRecords()[0].historyUid,rows[0].historyUid);
 a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;assert.equal(a.api.journal.data.enabled,false);assert.equal(a.api.unsaved(),true);await a.api.saveWorkspace();const b=setup();await open(b,fs);assert.equal(b.api.journal.data.enabled,false);
 await b.api.showBackups('all');b.document.getElementById('backup-clean-all').click();await b.api.state.backupTask;await new Promise(r=>setTimeout(r,5));assert.equal(b.api.journal.data.orders.length,0);
});
test('a malformed history file does not hide chats and cannot be silently overwritten',async()=>{
 const fs=memoryFS({'conversations.json':raw,'.viewer-state/viewer-history.json':'INVALID'}),a=setup();await open(a,fs);assert.equal(a.api.state.records.length,2);assert.equal(a.document.getElementById('app').hidden,false);assert.equal(await a.api.saveWorkspace(),false);assert.equal(await fs.files.get('.viewer-state/viewer-history.json').text(),'INVALID');
});
test('age cleanup persists after saving and reopening',async()=>{
 const fs=memoryFS({'conversations.json':raw}),a=setup(),rows=await open(a,fs),r=rows[0];a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'later'}]);await a.api.saveWorkspace();a.api.journal.data.records[r.historyUid].versions[0].time='2000-01-01T00:00:00Z';await a.api.showBackups('edit');a.document.getElementById('backup-days').value='30';a.document.getElementById('backup-clean-age').click();await a.api.state.backupTask;await new Promise(r=>setTimeout(r,5));assert.equal(a.api.journal.data.records[r.historyUid]?.versions.length||0,0);await a.api.saveWorkspace();const b=setup();await open(b,fs);assert.equal(b.api.journal.has(b.api.state.records[0].historyUid),false);

});
test('old full-backup controls are absent and existing disk files are not silently removed',async()=>{
 const fs=memoryFS({'conversations.json':raw,'.viewer-backups/old/conversations.json':'old file'}),a=setup();await open(a,fs);await a.api.showBackups();assert.equal(a.document.getElementById('backup-legacy'),null);assert.equal(a.document.querySelector('#backup-category option[value="legacy"]'),null);assert.ok(fs.files.has('.viewer-backups/old/conversations.json'));
});
