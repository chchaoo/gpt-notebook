const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs'),Store=require('../viewer_journal_store.js');
const raw=JSON.stringify([{id:'one',title:'A',mapping:{}},{id:'two',title:'Other',mapping:{}}]);
async function open(a,fs){const x=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records.find(r=>r.id==='one')}
function edit(a,r,value){a.api.commit([{doc:r.doc,path:[r.index,'title'],value}])}
async function seed(values=['B','C','D']){const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);for(const value of values){edit(a,r,value);await a.api.saveWorkspace()}return {a,fs,r,v:a.api.journal.data.records[r.historyUid].versions}}
const cursor=a=>a.document.querySelector('.backup-position');

test('latest position appears before history without creating or changing any persistent records',async()=>{
 const {a,fs,r,v}=await seed(),before=JSON.stringify(a.api.journal.data),calls=fs.calls.length;await a.api.showBackups('edit',r.historyUid);const marker=cursor(a);assert.equal(marker.dataset.location,'latest');assert.ok(marker.textContent.includes('最新保存版本 #4'));assert.ok(marker.textContent.includes('与磁盘一致'));assert.equal(marker.nextElementSibling.dataset.version,v[2].id);assert.equal(a.document.querySelectorAll('.backup-item').length,3);assert.equal(JSON.stringify(a.api.journal.data),before);assert.equal(fs.calls.length,calls);
});

test('restoring version two places the current marker between versions three and two and marks an unsaved draft',async()=>{
 const {a,fs,r,v}=await seed(),calls=fs.calls.length;await a.api.restoreBackup('edit',r.historyUid,v[1].id);assert.equal(r.raw.title,'B');await a.api.showBackups('edit',r.historyUid);const marker=cursor(a);assert.equal(marker.dataset.location,'history');assert.equal(marker.dataset.version,v[1].id);assert.equal(marker.previousElementSibling.dataset.version,v[2].id);assert.equal(marker.nextElementSibling.dataset.version,v[1].id);assert.equal(marker.nextElementSibling.getAttribute('aria-current'),'step');assert.ok(marker.textContent.includes('历史版本 #2'));assert.ok(marker.textContent.includes('未保存'));assert.equal(fs.calls.length,calls);assert.equal(a.api.journal.data.records[r.historyUid].versions.length,3);
});

test('editing, undoing and redoing a restored draft keeps the marker truthful, including returning to the saved head',async()=>{
 const {a,r,v}=await seed();await a.api.restoreBackup('edit',r.historyUid,v[1].id);await a.api.showBackups('edit',r.historyUid);edit(a,r,'E');assert.equal(cursor(a).dataset.location,'draft');assert.ok(cursor(a).textContent.includes('基于此历史版本的修改'));assert.equal(a.document.querySelector('[aria-current="step"]'),null);
 await a.api.historyEdit('undo');assert.equal(cursor(a).dataset.location,'history');assert.equal(cursor(a).dataset.version,v[1].id);await a.api.historyEdit('undo');assert.equal(r.raw.title,'D');assert.equal(cursor(a).dataset.location,'latest');assert.ok(cursor(a).textContent.includes('与磁盘一致'));await a.api.historyEdit('redo');assert.equal(cursor(a).dataset.version,v[1].id);assert.equal(cursor(a).dataset.location,'history');await a.api.historyEdit('redo');assert.equal(cursor(a).dataset.location,'draft');
});

test('saving a restoration creates a new saved position, keeps old batches, and reopens at that saved head',async()=>{
 const {a,fs,r,v}=await seed(),old=new Map([...fs.files].filter(([p])=>Store.managed(p)));await a.api.restoreBackup('edit',r.historyUid,v[1].id);await a.api.saveWorkspace();await a.api.showBackups('edit',r.historyUid);assert.equal(cursor(a).dataset.location,'latest');assert.ok(cursor(a).textContent.includes('最新保存版本 #5'));for(const [p,blob]of old)assert.equal(fs.files.get(p),blob);const b=setup(),row=await open(b,fs);await b.api.showBackups('edit',row.historyUid);assert.equal(row.raw.title,'B');assert.equal(cursor(b).dataset.location,'latest');assert.ok(cursor(b).textContent.includes('与磁盘一致'));
});

test('when identical content exists at several points, the explicitly restored point takes precedence',async()=>{
 const {a,r,v}=await seed(['B','A','C']);await a.api.restoreBackup('edit',r.historyUid,v[0].id);await a.api.showBackups('edit',r.historyUid);assert.equal(r.raw.title,'A');assert.equal(cursor(a).dataset.version,v[0].id);assert.ok(cursor(a).textContent.includes('历史版本 #1'));assert.equal(cursor(a).nextElementSibling.dataset.version,v[0].id);
});

test('order history has its own current position and moves to the restored order point',async()=>{
 const {a,r}=await seed(),other=a.api.state.records.find(x=>x.id==='two');a.api.moveRecord(other.key,r.key);await a.api.saveWorkspace();a.api.moveRecord(r.key,other.key);await a.api.saveWorkspace();const v=a.api.journal.data.orders;await a.api.restoreBackup('order',null,v[0].id);await a.api.showBackups('order');const marker=cursor(a);assert.equal(marker.dataset.kind,'order');assert.equal(marker.dataset.location,'history');assert.equal(marker.dataset.version,v[0].id);assert.equal(marker.nextElementSibling.dataset.version,v[0].id);assert.ok(marker.textContent.includes('未保存'));
});

test('deleting a pointed-to history item removes the obsolete pointer instead of mislabeling a renumbered version',async()=>{
 const {a,r,v}=await seed(),id=v[1].id;await a.api.restoreBackup('edit',r.historyUid,id);await a.api.deleteBackup('edit',r.historyUid,id);await a.api.showBackups('edit',r.historyUid);assert.notEqual(cursor(a).dataset.version,id);assert.equal(cursor(a).dataset.location,'draft');assert.equal(a.document.querySelector('[aria-current="step"]'),null);
});

test('current-position labels and help text switch languages immediately while the dialog is open',async()=>{
 const {a,r,v}=await seed();await a.api.restoreBackup('edit',r.historyUid,v[1].id);await a.api.showBackups('edit',r.historyUid);const language=a.document.getElementById('language');language.value='ja';language.dispatchEvent(new a.document.defaultView.Event('change'));assert.ok(cursor(a).textContent.includes('現在の位置'));assert.equal(cursor(a).textContent.includes('当前位置'),false);assert.equal(cursor(a).textContent.includes('历史版本'),false);language.value='en';language.dispatchEvent(new a.document.defaultView.Event('change'));assert.ok(cursor(a).textContent.includes('Current position'));assert.ok(cursor(a).textContent.includes('Historical version #2'));
});
