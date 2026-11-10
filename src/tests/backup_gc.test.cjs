const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{diskFS}=require('./disk_fs.cjs'),{memoryFS}=require('./memory_fs.cjs'),Store=require('../viewer_journal_store.js');
const raw=JSON.stringify([{id:'one',title:'A',mapping:{}},{id:'two',title:'Second',mapping:{}}]);
async function open(a,disk){const x=await a.ctx.ViewerStorage.directory(disk.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records.find(r=>r.id==='one')}
function edit(a,r,title){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:title}])}
async function seed(t){const disk=await diskFS(t,{'conversations.json':raw}),a=setup({editing:true}),r=await open(a,disk);for(const value of ['B','C','D']){edit(a,r,value);await a.api.saveWorkspace()}return {disk,a,r,versions:[...a.api.journal.data.records[r.historyUid].versions]}}
async function click(a,id){a.document.getElementById(id).click();await a.api.state.backupTask}

test('real disk: clear-all immediately removes the complete history folder, keeps configuration and leaves chat drafts unsaved',async t=>{
 const {disk,a,r}=await seed(t),saved=await disk.read('conversations.json');await disk.put('.viewer-backups/legacy/conversations.json','old full snapshot');await disk.put('.viewer-backups/unrecognized-orphan.bin',Buffer.from([1,2,3]));edit(a,r,'unsaved draft');await a.api.showBackups();await click(a,'backup-clean-all');
 assert.equal(await disk.exists('.viewer-backups'),false);assert.equal(await disk.exists('.viewer-state/viewer-history.json'),true);assert.equal(await disk.exists('.viewer-state/viewer-settings.json'),true);assert.equal(await disk.read('conversations.json'),saved);assert.equal(r.raw.title,'unsaved draft');assert.equal(a.api.unsaved(),true);assert.equal(JSON.parse(await disk.read(Store.path)).head,null);assert.equal(a.document.getElementById('backup-dialog').open,true);
 const b=setup({editing:true});await open(b,disk);assert.equal(Object.keys(b.api.journal.data.records).length,0);assert.equal(b.api.journal.data.enabled,true);
});

test('real disk: disabling persists without a separate Save, removes old aggregates and remains disabled after reopening',async t=>{
 const {disk,a}=await seed(t);await disk.put('.viewer-backups/leftover/sub/old.json','obsolete history');await click(a,'backup-toggle');assert.equal(await disk.exists('.viewer-backups'),false);assert.equal(JSON.parse(await disk.read(Store.path)).enabled,false);assert.equal(a.api.unsaved(),false);const b=setup({editing:true});await open(b,disk);assert.equal(b.api.journal.data.enabled,false);
});

test('real disk: deleting a middle checkpoint composes adjacent reverse deltas and reclaims every obsolete batch',async t=>{
 const {disk,a,r,versions}=await seed(t),before=new Set([...(await disk.contents()).keys()].filter(Store.managed)),states=new Map(versions.map(v=>[v.id,a.api.journal.target(r.historyUid,v.id)]));assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[1].id),true);const after=await disk.contents();for(const p of before)assert.equal(after.has(p),false);assert.equal([...after.keys()].filter(Store.managed).length,2);assert.equal(a.api.journal.target(r.historyUid,versions[0].id),states.get(versions[0].id));assert.equal(a.api.journal.target(r.historyUid,versions[2].id),states.get(versions[2].id));const b=setup({editing:true}),row=await open(b,disk);assert.deepEqual(Array.from(b.api.journal.data.records[row.historyUid].versions,v=>JSON.parse(b.api.journal.target(row.historyUid,v.id)).title),['A','C']);
});

test('real disk: partial deletion failure restores physical files and displayed history, then retries successfully',async t=>{
 const {disk,a,r,versions}=await seed(t),before=await disk.contents(),paths=[...before.keys()].filter(Store.managed);let once=true;disk.control.fail=(phase,p)=>phase==='remove'&&p===paths[1]&&once?(once=false,new Error('locked file')):null;assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[1].id),false);const after=await disk.contents();assert.deepEqual([...after.keys()].sort(),[...before.keys()].sort());for(const [p,bytes]of before)assert.deepEqual(after.get(p),bytes);assert.equal(a.api.journal.data.records[r.historyUid].versions.length,3);disk.control.fail=null;assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[1].id),true);
});

test('real disk: orphan files are reclaimed even when the index already contains no history',async t=>{
 const {disk,a}=await seed(t);await click(a,'backup-clean-all');await disk.put('.viewer-backups/segments/orphan.json','uncommitted batch');const b=setup({editing:true});await open(b,disk);assert.equal(Object.keys(b.api.journal.data.records).length,0);await click(b,'backup-clean-all');assert.equal(await disk.exists('.viewer-backups'),false);
});

test('real disk: old control files migrate out of the history folder and preserve disabled state',async t=>{
 const disk=await diskFS(t,{'conversations.json':raw,'.viewer-backups/viewer-history.json':JSON.stringify({version:141,enabled:false,records:{},orders:[],bindings:[]}),'.viewer-backups/viewer-settings.json':'{"version":1,"sort":"title","order":[]}'}),a=setup({editing:true});await open(a,disk);assert.equal(a.api.journal.data.enabled,false);assert.equal(await a.api.saveWorkspace(),true);assert.equal(await disk.exists('.viewer-backups'),false);assert.equal(await disk.exists(Store.path),true);const b=setup({editing:true});await open(b,disk);assert.equal(b.api.journal.data.enabled,false);assert.equal(b.api.state.sort,'title');
});

test('ZIP cleanup removes the history directory including old files and keeps only state metadata',async()=>{
 const a=setup({editing:true}),zip=new a.ctx.JSZip();zip.file('export/conversations.json',raw);zip.file('export/.viewer-backups/legacy/old.json','obsolete history');const initial=await zip.generateAsync({type:'uint8array'}),disk=memoryFS({'data.zip':initial}),opened=await a.ctx.ViewerStorage.zip(await disk.file('data.zip').getFile(),disk.file('data.zip'));await a.api.loadEntries(opened.entries,null,opened.source);const r=a.api.state.records[0];edit(a,r,'B');await a.api.saveWorkspace();edit(a,r,'draft C');await click(a,'backup-toggle');const saved=await require('../vendor/jszip/jszip.min.js').loadAsync(await disk.files.get('data.zip').arrayBuffer());assert.equal(Object.keys(saved.files).some(p=>p.startsWith('export/.viewer-backups/')),false);assert.ok(saved.file('export/'+Store.path));assert.equal(JSON.parse(await saved.file('export/conversations.json').async('string'))[0].title,'B');assert.equal(r.raw.title,'draft C');const b=setup({editing:true}),x=await b.ctx.ViewerStorage.zip(disk.files.get('data.zip'));await b.api.loadEntries(x.entries,null,x.source);assert.equal(b.api.journal.data.enabled,false);
});

test('restoration keeps the manager open, visibly moves the position, and blocks overlapping restorations',async t=>{
 const {a,r,versions}=await seed(t);await a.api.showBackups('edit',r.historyUid);const first=a.api.restoreBackup('edit',r.historyUid,versions[1].id),second=a.api.restoreBackup('edit',r.historyUid,versions[0].id);await second;await first;assert.equal(a.document.getElementById('backup-dialog').open,true);assert.equal(r.raw.title,'B');let marker=a.document.querySelector('.backup-position');assert.equal(marker.dataset.version,versions[1].id);await a.api.restoreBackup('edit',r.historyUid,versions[0].id);marker=a.document.querySelector('.backup-position');assert.equal(marker.dataset.version,versions[0].id);assert.equal(r.raw.title,'A');assert.equal(a.document.getElementById('backup-dialog').open,true);a.document.getElementById('backup-close').click();assert.equal(a.document.getElementById('backup-dialog').open,false);
});

test('clearing saved history does not discard the pending net backup for an unsaved draft',async t=>{
 const {disk,a,r}=await seed(t);edit(a,r,'new draft');await click(a,'backup-clean-all');assert.equal(a.api.journal.data.records[r.historyUid],undefined);await a.api.saveWorkspace();const versions=a.api.journal.data.records[r.historyUid].versions;assert.equal(versions.length,1);assert.equal(JSON.parse(a.api.journal.target(r.historyUid,versions[0].id)).title,'D');const b=setup({editing:true}),row=await open(b,disk);assert.equal(JSON.parse(b.api.journal.target(row.historyUid,versions[0].id)).title,'D');
});

test('real disk: an empty-directory removal failure is reported distinctly and can be retried',async t=>{
 const {disk,a}=await seed(t);disk.control.fail=(phase,p)=>phase==='remove'&&p==='.viewer-backups'?new Error('folder temporarily in use'):null;await click(a,'backup-clean-all');assert.equal(a.api.state.backupCleanupWarning,true);assert.equal(await disk.exists('.viewer-backups'),true);assert.equal([...(await disk.contents()).keys()].some(p=>p.startsWith('.viewer-backups/')),false);disk.control.fail=null;await click(a,'backup-clean-all');assert.equal(a.api.state.backupCleanupWarning,false);assert.equal(await disk.exists('.viewer-backups'),false);
});

test('readonly sources without write APIs retain pending cleanup and do not claim physical removal',async t=>{
 const {disk,a}=await seed(t),before=await disk.contents();a.api.state.source={kind:'embedded',name:'portable.html'};await click(a,'backup-clean-all');assert.equal(a.api.journal.maintenanceDirty,true);assert.equal(a.api.unsaved(),true);const after=await disk.contents();assert.deepEqual([...after.keys()].sort(),[...before.keys()].sort());for(const [p,bytes]of before)assert.deepEqual(after.get(p),bytes);assert.equal(a.api.state.backupCleanupWarning,false);
});

test('all eleven languages immediately translate the new maintenance help, status and actions',async t=>{
 const {a}=await seed(t);await a.api.showBackups();const keys=['关闭增量备份','备份更改尚未写入','备份已写入','有待保存的聊天修改','空目录未能移除','正在写入备份更改','备份操作未完成：','备份更改已写入，聊天草稿未另行保存。','当前资料不能直接写回，备份更改尚未写入；请另存为资料。','关闭增量备份会在确认后删除全部历史文件并停止记录，直接写入资料；不会保存聊天草稿。'];for(const locale of a.ctx.ViewerI18n.locales){const language=a.document.getElementById('language');language.value=locale;language.dispatchEvent(new a.document.defaultView.Event('change'));for(const key of keys)if(locale!=='zh-CN')assert.notEqual(a.ctx.ViewerI18n.t(key),key,locale+': '+key);assert.equal(a.document.getElementById('backup-toggle').title,a.ctx.ViewerI18n.t('关闭增量备份'));assert.ok(a.document.getElementById('backup-summary').textContent.includes(a.ctx.ViewerI18n.t('备份已写入')))}
});

test('real disk: repeated middle deletions preserve every retained state, including repeated text and Unicode',async t=>{
 const disk=await diskFS(t,{'conversations.json':raw}),a=setup({editing:true}),r=await open(a,disk);for(const value of ['B','A','中文🔥','C','A','D']){edit(a,r,value);await a.api.saveWorkspace()}const original=[...a.api.journal.data.records[r.historyUid].versions],expected=new Map(original.map(v=>[v.id,a.api.journal.target(r.historyUid,v.id)]));for(const n of [2,4,1]){const id=original[n].id;await a.api.deleteBackup('edit',r.historyUid,id);expected.delete(id);for(const v of a.api.journal.data.records[r.historyUid].versions)assert.equal(a.api.journal.target(r.historyUid,v.id),expected.get(v.id))}const b=setup({editing:true}),row=await open(b,disk);for(const v of b.api.journal.data.records[row.historyUid].versions)assert.equal(b.api.journal.target(row.historyUid,v.id),expected.get(v.id));assert.equal([...(await disk.contents()).keys()].filter(Store.managed).length,3);
});

test('real disk: explicitly resetting unavailable history removes corrupt and orphan payloads without saving the chat',async t=>{
 const disk=await diskFS(t,{'conversations.json':raw,'.viewer-backups/viewer-history.json':'broken history','.viewer-backups/segments/orphan.json':'broken batch'}),a=setup({editing:true}),r=await open(a,disk);assert.ok(a.api.state.journalProblem);edit(a,r,'draft');await a.api.showBackups();const reset=[...a.document.querySelectorAll('#backup-list button')].find(b=>b.textContent==='重置不可用历史');assert.ok(reset);reset.click();await a.api.state.backupTask;assert.equal(a.api.state.journalProblem,null);assert.equal(await disk.exists('.viewer-backups'),false);assert.equal(await disk.read('conversations.json'),raw);await a.api.saveWorkspace();const v=a.api.journal.data.records[r.historyUid].versions;assert.equal(JSON.parse(a.api.journal.target(r.historyUid,v[0].id)).title,'A');
});
