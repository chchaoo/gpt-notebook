const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../viewer_core.js'),J=require('../viewer_journal.js'),Store=require('../viewer_journal_store.js');
const {setup}=require('./dom_checks.cjs'),{diskFS}=require('./disk_fs.cjs'),{memoryFS}=require('./memory_fs.cjs');
const raw='[{"id":"one","title":"A","number":900719925474099399,"mapping":{}},{"id":"two","title":"Second","mapping":{}}]';
const clone=x=>JSON.parse(JSON.stringify(x));
function model(text=raw,entries=new Map()){
 const doc=C.document(text);doc.path='conversations.json';
 const records=doc.data.map((raw,index)=>({doc,raw,index,id:raw.id,key:String(index)})),journal=J.create(),store=Store.create();let order=records.map(r=>r.key);
 function commit(plan){for(const p of plan.removedPaths)entries.delete(p);for(const e of plan.entries)entries.set(e.path,e);store.accept(plan)}
 return {doc,records,journal,store,entries,async open(){const saved=await store.open(entries);journal.open(records,order,saved);store.align(journal.data,journal.dirty);return this},
  save(title){if(title!==undefined)C.change(doc,[0,'title'],title);const candidate=journal.prepare(journal.capture(records,order)),plan=store.prepare(candidate.data);commit(plan);journal.accept(candidate);return plan},
  maintain(predicate){journal.purge(predicate);const plan=store.prepare(journal.data);commit(plan);journal.acceptMaintenance();return plan},
  reorder(){order=order.toReversed();return this.save()},text(){return journal.serializeDocument(doc)},async reopen(){return model(this.text(),new Map(entries)).open()}};
}
async function seed(){const a=await model().open();for(const title of ['B','A','中文🔥','escaped "\\\n','A','D'])a.save(title);return a}
function targets(a){return new Map(Object.entries(a.journal.data.records).flatMap(([uid,m])=>m.versions.map(v=>[v.id,{uid,raw:a.journal.target(uid,v.id)}])))}
async function check(a,expected){
 const b=await a.reopen();assert.equal(b.journal.dirty,false);
 const actual=targets(b);assert.deepEqual(actual,expected);assert.deepEqual(clone(b.journal.data),clone(a.journal.data));
 assert.ok(b.text().includes('900719925474099399'));return b;
}
function permutations(values){if(!values.length)return [[]];return values.flatMap((v,i)=>permutations(values.filter((_,n)=>n!==i)).map(rest=>[v,...rest]))}

test('middle deletion preserves the byte-identical prefix and separate batches; subsequent saves only append',async()=>{
 const a=await seed(),before=new Map(a.entries),versions=a.journal.data.records[a.records[0].historyUid].versions,expected=targets(a);
 const plan=a.maintain(v=>v.id===versions[4].id);expected.delete(versions[4].id);
 const old=[...before.keys()].filter(Store.managed);assert.equal(old.length,6);
 for(const p of old.slice(0,3)){assert.equal(a.entries.get(p),before.get(p));assert.equal(plan.removedPaths.has(p),false);assert.equal(plan.entries.some(e=>e.path===p),false)}
 for(const p of old.slice(3))assert.equal(a.entries.has(p),false);
 assert.equal(plan.entries.filter(e=>Store.managed(e.path)).length,2);assert.equal([...a.entries.keys()].filter(Store.managed).length,5);
 const b=await check(a,expected),retained=new Map(b.entries),appended=b.save('new after deletion');assert.equal(appended.entries.filter(e=>Store.managed(e.path)).length,1);assert.equal(appended.removedPaths.size,0);
 for(const [p,e] of retained)if(Store.managed(p))assert.equal(b.entries.get(p),e);
 await check(b,targets(b));
});

test('all 120 deletion orders of five checkpoints round-trip after every deletion, including empty history',async()=>{
 const initial=await seed();initial.maintain(v=>v.id===[...targets(initial).keys()][5]);const ids=[...targets(initial).keys()],text=initial.text();
 for(const sequence of permutations(ids)){
  let a=await model(text,new Map(initial.entries)).open(),expected=targets(a);
  for(const id of sequence){a.maintain(v=>v.id===id);expected.delete(id);assert.equal([...a.entries.keys()].filter(Store.managed).length,expected.size);a=await check(a,expected)}
  assert.equal(JSON.parse(await a.entries.get(Store.path).blob.text()).head,null);
 }
});

test('deleting within an old aggregate keeps other checkpoints in that batch and later batches separate',async()=>{
 const a=await seed(),logical=clone(a.journal.data);a.entries.clear();a.entries.set(Store.path,{path:Store.path,blob:new Blob([JSON.stringify(logical)])});
 const b=await a.reopen();b.save('E');b.save('F');assert.equal([...b.entries.keys()].filter(Store.managed).length,2);
 const expected=targets(b),ids=[...expected.keys()];b.maintain(v=>v.id===ids[2]);expected.delete(ids[2]);assert.equal([...b.entries.keys()].filter(Store.managed).length,2);await check(b,expected);
});

test('mixed conversations and order history retain all unselected versions and current metadata',async()=>{
 let a=await model().open();for(let i=0;i<6;i++){C.change(a.doc,[1,'title'],'other '+i);a.save('first '+i);a.reorder()}
 const expected=targets(a),orderTargets=new Map(a.journal.data.orders.map(v=>[v.id,clone(a.journal.orderStateTarget(v.id))])),uid=a.records[0].historyUid;
 const ids=[...expected].filter(([,v])=>v.uid===uid).map(([id])=>id),orderIds=[...orderTargets.keys()];
 a.maintain(v=>v.kind==='edit'&&ids.slice(2,4).includes(v.id)||v.kind==='order'&&orderIds.slice(1,4).includes(v.id));
 for(const id of ids.slice(2,4))expected.delete(id);for(const id of orderIds.slice(1,4))orderTargets.delete(id);
 a=await check(a,expected);for(const [id,state]of orderTargets)assert.deepEqual(clone(a.journal.orderStateTarget(id)),state);
 assert.ok([...a.entries.keys()].filter(Store.managed).length>1);
});

test('deferred deletion followed by edits and save retains separate existing batches and appends new history',async()=>{
 const a=await seed(),uid=a.records[0].historyUid,ids=[...targets(a).keys()],expected=targets(a);a.journal.purge(v=>v.id===ids[4]);expected.delete(ids[4]);
 const latest=a.journal.rowRaw(a.records[0],true),plan=a.save('unsaved after deferred cleanup');assert.equal(plan.clearBackupFolder,false);assert.equal([...a.entries.keys()].filter(Store.managed).length,6);
 const b=await a.reopen();for(const [id,value]of expected)assert.equal(b.journal.target(uid,id),value.raw);
 assert.equal(b.journal.target(uid,b.journal.data.records[uid].versions.at(-1).id),latest);
});

test('rewriting a suffix remains readable by the original 143 linked-chain contract and rejects corruption',async()=>{
 const a=await seed(),ids=[...targets(a).keys()];a.maintain(v=>v.id===ids[4]);const index=JSON.parse(await a.entries.get(Store.path).blob.text());assert.equal(index.version,143);
 let path=index.head,hash=index.headHash,count=0;const seen=new Set();
 while(path){assert.equal(seen.has(path),false);seen.add(path);const text=await a.entries.get(path).blob.text();assert.equal(text.length+':'+C.crc32(new TextEncoder().encode(text)).toString(16),hash);const batch=JSON.parse(text);assert.equal(batch.version,143);assert.equal(path,Store.prefix+batch.id+'.json');path=batch.previous;hash=batch.previousHash;count++}
 assert.equal(count,5);assert.equal(hash,null);
 const corrupted=new Map(a.entries),entry=corrupted.get(index.head),batch=JSON.parse(await entry.blob.text());batch.changes.records[a.records[0].historyUid].meta.title='tampered';corrupted.set(index.head,{path:index.head,blob:new Blob([JSON.stringify(batch)])});
 await assert.rejects(Store.create().open(corrupted));const missing=new Map(a.entries);missing.delete(index.head);await assert.rejects(Store.create().open(missing));
});

async function openUI(a,disk){const x=await a.ctx.ViewerStorage.directory(disk.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records.find(r=>r.id==='one')}
async function diskSeed(t){const disk=await diskFS(t,{'conversations.json':raw}),a=setup(),r=await openUI(a,disk);for(const title of ['B','C','D','E','F','G']){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:title}]);assert.equal(await a.api.saveWorkspace(),true)}return {disk,a,r}}

test('real disk: suffix deletion never opens unchanged prefix files, preserves drafts, and reopens every retained state',async t=>{
 const {disk,a,r}=await diskSeed(t),before=await disk.contents(),paths=[...a.api.state.entries.keys()].filter(Store.managed),versions=a.api.journal.data.records[r.historyUid].versions,expected=new Map(versions.map(v=>[v.id,a.api.journal.target(r.historyUid,v.id)]));
 a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'draft kept'}]);const start=disk.calls.length;assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[4].id),true);expected.delete(versions[4].id);
 const after=await disk.contents();for(const p of paths.slice(0,3)){assert.deepEqual(after.get(p),before.get(p));assert.equal(disk.calls.slice(start).some(([,path])=>path===p),false)}
 assert.deepEqual(after.get('conversations.json'),before.get('conversations.json'));assert.equal(r.raw.title,'draft kept');assert.equal(a.api.unsaved(),true);assert.equal([...after.keys()].filter(Store.managed).length,5);
 const b=setup(),row=await openUI(b,disk);for(const [id,raw] of expected)assert.equal(b.api.journal.target(row.historyUid,id),raw);
 assert.equal(await a.api.saveWorkspace(),true);const c=setup(),saved=await openUI(c,disk);assert.equal(saved.raw.title,'draft kept');assert.equal([...c.api.state.entries.keys()].filter(Store.managed).length,6);
});

test('real disk: failures at new payload, index commit and each suffix removal restore exact files and permit retry',async t=>{
 const {disk,a,r}=await diskSeed(t),versions=a.api.journal.data.records[r.historyUid].versions,paths=[...a.api.state.entries.keys()].filter(Store.managed),before=await disk.contents();
 const cases=[['write','payload'],['close','payload'],['close',Store.path],...paths.slice(3).map(p=>['remove',p])];
 for(const [phase,target]of cases){let triggered=false;disk.control.fail=(action,p)=>!triggered&&action===phase&&(target==='payload'?Store.managed(p)&&!before.has(p):p===target)?(triggered=true,new Error('injected '+phase)):null;
  assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[4].id),false,phase+' '+target);assert.equal(triggered,true);const actual=await disk.contents();assert.deepEqual([...actual.keys()].sort(),[...before.keys()].sort());for(const [p,bytes]of before)assert.deepEqual(actual.get(p),bytes,p);assert.equal(a.api.journal.data.records[r.historyUid].versions.length,6);
  const b=setup(),row=await openUI(b,disk);assert.equal(b.api.journal.data.records[row.historyUid].versions.length,6);
 }
 disk.control.fail=null;assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[4].id),true);assert.equal([...(await disk.contents()).keys()].filter(Store.managed).length,5);
});

test('ZIP: deletion preserves separate segments, retained restoration states and unsaved chat drafts',async()=>{
 const a=setup(),zip=new a.ctx.JSZip();zip.file('export/conversations.json',raw);const disk=memoryFS({'data.zip':await zip.generateAsync({type:'uint8array'})}),x=await a.ctx.ViewerStorage.zip(await disk.file('data.zip').getFile(),disk.file('data.zip'));await a.api.loadEntries(x.entries,null,x.source);
 const r=a.api.state.records[0];for(const title of ['B','C','D','E']){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:title}]);assert.equal(await a.api.saveWorkspace(),true)}
 const versions=a.api.journal.data.records[r.historyUid].versions,expected=new Map(versions.map(v=>[v.id,a.api.journal.target(r.historyUid,v.id)]));a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'draft'}]);assert.equal(await a.api.deleteBackup('edit',r.historyUid,versions[2].id),true);expected.delete(versions[2].id);
 const saved=await a.ctx.ViewerStorage.zip(await disk.file('data.zip').getFile(),disk.file('data.zip')),b=setup();await b.api.loadEntries(saved.entries,null,saved.source);const row=b.api.state.records[0];assert.equal(row.raw.title,'E');assert.equal(r.raw.title,'draft');assert.equal(a.api.unsaved(),true);assert.equal([...b.api.state.entries.keys()].filter(Store.managed).length,3);for(const [id,value]of expected)assert.equal(b.api.journal.target(row.historyUid,id),value);
});

test('deleting the latest tombstone checkpoint keeps deleted metadata restorable after reopen',async()=>{
 const disk=memoryFS({'conversations.json':raw}),a=setup(),r=await openUI(a,disk),uid=r.historyUid;
 for(const title of ['B','C','D']){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:title}]);await a.api.saveWorkspace()}
 a.api.deleteRecords([r.key]);assert.equal(await a.api.saveWorkspace(),true);const versions=a.api.journal.data.records[uid].versions,expected=new Map(Array.from(versions,v=>[v.id,a.api.journal.target(uid,v.id)])),removed=versions.at(-1).id;
 // Deleting a conversation also records the list order in its save batch.
 // Removing the content checkpoint must preserve that independent order event.
 assert.equal(await a.api.deleteBackup('edit',uid,removed),true);expected.delete(removed);assert.equal([...a.api.state.entries.keys()].filter(Store.managed).length,4);
 const b=setup();await openUI(b,disk);assert.equal(b.api.journal.data.records[uid].present,false);assert.ok(expected.has(b.api.journal.data.records[uid].deleted.version));for(const [id,value]of expected)assert.equal(b.api.journal.target(uid,id),value);
 await b.api.restoreBackup('deleted',uid,null);assert.equal(b.api.state.records.find(r=>r.historyUid===uid).raw.title,'C');
});

test('permanently removing one deleted conversation retains shared batches and every other conversation version',async()=>{
 const disk=memoryFS({'conversations.json':raw}),a=setup(),r=await openUI(a,disk),other=a.api.state.records[1];
 for(let i=0;i<4;i++){a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'one '+i},{doc:other.doc,path:[other.index,'title'],value:'two '+i}]);await a.api.saveWorkspace()}
 const expected=new Map(Array.from(a.api.journal.data.records[other.historyUid].versions,v=>[v.id,a.api.journal.target(other.historyUid,v.id)]));a.api.deleteRecords([r.key]);await a.api.saveWorkspace();assert.equal(await a.api.deleteBackup('deleted',r.historyUid,null),true);
 const b=setup();await openUI(b,disk);assert.equal(b.api.journal.data.records[r.historyUid],undefined);assert.ok([...b.api.state.entries.keys()].filter(Store.managed).length>=4);for(const [id,value]of expected)assert.equal(b.api.journal.target(other.historyUid,id),value);
 for(const e of b.api.state.entries.values())if(Store.managed(e.path))assert.equal(Object.hasOwn(JSON.parse(await e.blob.text()).changes.records,r.historyUid),false);
});
