const {test}=require('node:test'),assert=require('node:assert/strict'),J=require('../viewer_journal.js'),C=require('../viewer_core.js');
function fixture(text='initial'){const doc=C.document(JSON.stringify([{id:'one',title:'one',mapping:{n:{message:{content:{parts:[text]}}}}},{id:'two',title:'two',mapping:{}}]));doc.path='conversations.json';const records=doc.data.map((raw,index)=>({doc,raw,index,id:raw.id,key:String(index)}));const journal=J.create();journal.open(records,[],null);return {doc,records,journal,save(list=records,order){const next=journal.prepare(journal.capture(list,order));journal.accept(next);return next}}}
test('one-character edits in huge conversations store tiny per-field deltas, without other conversations',()=>{
 const a=fixture('A'.repeat(300000));C.change(a.doc,[0,'mapping','n','message','content','parts',0],'A'.repeat(150000)+'B'+'A'.repeat(149999));a.save();
 const encoded=JSON.stringify(a.journal.data);assert.ok(encoded.length<1500,encoded.length);assert.equal(Object.keys(a.journal.data.records).length,1);const uid=a.records[0].historyUid,v=a.journal.data.records[uid].versions[0];assert.ok(a.journal.target(uid,v.id).includes('A'.repeat(300000)));
});
test('separate edits around a huge unchanged field region do not duplicate the region',()=>{
 const before=JSON.stringify({text:'start '+('A'.repeat(300000))+' end'}),after=JSON.stringify({text:'START '+('A'.repeat(300000))+' END'}),patch=J.delta(after,before);assert.ok(JSON.stringify(patch).length<800,JSON.stringify(patch).length);assert.equal(J.apply(after,patch),before);
});
test('incremental string hunks round-trip Unicode, escaped JSON and multiple insert/delete combinations',()=>{
 let seed=17;const next=()=>seed=(seed*1664525+1013904223)>>>0;
 for(let i=0;i<80;i++){const original=Array.from({length:700},()=>['汉','😀','"','\\','a','\n'][next()%6]).join('');let edited=original;for(let j=0;j<6;j++){const at=next()%(edited.length+1);edited=edited.slice(0,at)+'改'+edited.slice(at+(next()%4))}const before=JSON.stringify({text:original}),after=JSON.stringify({text:edited});assert.equal(J.apply(after,J.delta(after,before)),before)}
});
test('removing a middle checkpoint rebases remaining history and never needs it to restore older versions',()=>{
 const a=fixture();for(const title of ['v1','v2','v3']){C.change(a.doc,[0,'title'],title);a.save()}const uid=a.records[0].historyUid,versions=[...a.journal.data.records[uid].versions];
 a.journal.purge(v=>v.id===versions[1].id);assert.equal(a.journal.data.records[uid].versions.length,2);assert.equal(JSON.parse(a.journal.target(uid,versions[0].id)).title,'one');assert.equal(JSON.parse(a.journal.target(uid,versions[2].id)).title,'v2');
});
test('deletions retain only deleted conversation data, survive reopen and can be purged',()=>{
 const a=fixture();a.save([a.records[1]]);const uid=a.records[0].historyUid,copy=JSON.parse(JSON.stringify(a.journal.data)),j=J.create();j.open([a.records[1]],[],copy);assert.equal(JSON.parse(j.target(uid)).id,'one');j.purge(v=>v.kind==='deleted');assert.equal(j.data.records[uid],undefined);
});
test('order checkpoints and removal of an adjacent order checkpoint preserve reconstruction',()=>{
 const a=fixture();a.save(a.records,['1','0']);a.save(a.records,['0','1']);const versions=[...a.journal.data.orders];assert.equal(versions.length,2);a.journal.purge(v=>v.kind==='order'&&v.id===versions[1].id);assert.deepEqual(a.journal.orderTarget(versions[0].id),a.records.map(r=>r.historyUid));
});
test('disabling clears all persistent history and enabling starts from the then-current state',()=>{
 const a=fixture();C.change(a.doc,[0,'title'],'B');a.save();a.journal.setEnabled(false);assert.equal(Object.keys(a.journal.data.records).length,0);C.change(a.doc,[0,'title'],'C');a.save();assert.equal(Object.keys(a.journal.data.records).length,0);a.journal.setEnabled(true,a.journal.capture(a.records));C.change(a.doc,[0,'title'],'D');a.save();const uid=a.records[0].historyUid,v=a.journal.data.records[uid].versions[0];assert.equal(JSON.parse(a.journal.target(uid,v.id)).title,'C');
});
test('reverse patches preserve exact large integers, escapes, and distant changed fields',()=>{
 const before='{"id":900719925474099399,"title":"\\u4e00","tail":"a"}',after='{"id":900719925474099399,"title":"二","tail":"b"}',d=J.delta(after,before);assert.equal(J.apply(after,d),before);assert.equal(d.fields.length,2);assert.throws(()=>J.apply(after+' ',d),/校验/);
});
test('partial directory commit can align a journal to data that remained at the preceding checkpoint',()=>{
 const a=fixture();C.change(a.doc,[0,'title'],'new');const candidate=a.journal.prepare(a.journal.capture(a.records));const old=fixture(),j=J.create();j.open(old.records,[],candidate.data);assert.equal(j.dirty,true);assert.equal(j.data.records[old.records[0].historyUid].versions.length,0);
});
test('partial deletion commit does not make still-present data appear as a second deleted conversation',()=>{
 const a=fixture(),candidate=a.journal.prepare(a.journal.capture([a.records[1]],['1'])),original=fixture(),j=J.create();j.open(original.records,[],candidate.data);assert.equal(j.dirty,true);assert.equal(j.data.records[original.records[0].historyUid].deleted,undefined);
});
test('binding indices retain invalid-but-preserved JSON rows before a valid conversation',()=>{
 const doc=C.document('[{"unknown":true},{"id":"valid","title":"v","mapping":{}}]');doc.path='conversations.json';const r={doc,index:1,raw:doc.data[1],id:'valid',key:'v'},j=J.create();j.open([r],[],null);const candidate=j.prepare(j.capture([r]));assert.equal(candidate.data.bindings[0].index,1);
});
