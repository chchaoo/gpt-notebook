const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../viewer_exports.js'),C=require('../viewer_core.js'),Zip=require('../vendor/jszip/jszip.min.js'),IO=require('../viewer_storage.js')(C,Zip),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const shell='<html><script id="data" type="application/json">{"private":"OTHER-SENTINEL"}</script></html>';
function chat(id){return {id,title:id,current_node:'a',unknown:{preserve:true},mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:[id+' file_12345678']}}},a:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:[id+' answer']}}},old:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['other branch']}}}}}}
function data(){const one=C.document(JSON.stringify([chat('selected'),chat('OTHER-SENTINEL')])),two=C.document(JSON.stringify([chat('second')]));one.path='conversations-000.json';two.path='conversations-001.json';const resources=new Map([['file_12345678',{path:'media/file_12345678.png',name:'原图.png',blob:new Blob(['selected bytes'],{type:'image/png'})}],['file_87654321',{path:'file_87654321.png',name:'unused.png',blob:new Blob(['OTHER-ASSET'])}]]);return {one,two,resources,rows:[{doc:one,index:0,key:'0',id:'selected',raw:one.data[0]},{doc:two,index:0,key:'2',id:'second',raw:two.data[0]}]}}
async function loaded(a){const f=data();await a.api.loadEntries([{path:f.one.path,blob:new Blob([C.serialize(f.one)])},{path:f.two.path,blob:new Blob([C.serialize(f.two)])},...Array.from(f.resources.values()),{path:'user.json',blob:new Blob(['OTHER-ACCOUNT'])}]);return a.api.state.records}
test('subset bundle preserves source shards, complete branches, unknown fields and relevant assets only',async()=>{
 const f=data();C.change(f.one,[0,'title'],'EDITED DRAFT');const entries=await E.bundle(f.rows,f.resources,shell,{editMode:true}),files=new Map(entries.map(e=>[e.path,e.blob]));
 assert.ok(files.has('conversations-000.json'));assert.ok(files.has('conversations-001.json'));assert.ok(files.has('chat.html'));assert.ok(files.has('export_manifest.json'));
 const first=JSON.parse(await files.get('conversations-000.json').text());assert.equal(first.length,1);assert.equal(first[0].title,'EDITED DRAFT');assert.equal(first[0].unknown.preserve,true);assert.ok(first[0].mapping.old);
 assert.equal(await files.get('media/file_12345678.png').text(),'selected bytes');assert.ok(!files.has('file_87654321.png'));
 const all=(await Promise.all(entries.map(e=>e.blob.text()))).join('\n');assert.ok(!all.includes('OTHER-SENTINEL'));assert.ok(!all.includes('OTHER-ASSET'));
 const settings=JSON.parse(await files.get('.viewer-state/viewer-settings.json').text());assert.deepEqual(settings.order.map(x=>[x.path,x.index]),[['conversations-000.json',0],['conversations-001.json',0]]);
 const manifest=JSON.parse(await files.get('export_manifest.json').text());for(const e of manifest.export_files)assert.equal(e.size_bytes,files.get(e.path).size);
 const a=setup({editing:true});await a.api.loadEntries(entries);assert.equal(a.api.state.records.length,2);assert.equal(a.api.state.resources.get('file_12345678').name,'原图.png');
});
test('new ZIP never inherits unused source ZIP entries; imported subset round-trips without other chats',async()=>{
 const f=data(),entries=await E.bundle([f.rows[0]],f.resources,shell),blob=await IO.zipBlob(null,entries),opened=await IO.zip(blob),a=setup({editing:true});await a.api.loadEntries(opened.entries);assert.equal(a.api.state.records.length,1);assert.equal(a.api.state.records[0].id,'selected');
 const archive=await Zip.loadAsync(await blob.arrayBuffer());assert.ok(!archive.files['user.json']);assert.ok(!archive.files['conversations-001.json']);
});
test('folder output is equivalent to ZIP entries, nonempty target is refused, write failure cleans created files',async()=>{
 const f=data(),entries=await E.bundle(f.rows,f.resources,shell),target=memoryFS();await IO.exportDirectory(target.root,entries);assert.equal(target.files.size,entries.length);for(const e of entries)assert.equal(await target.files.get(e.path).text(),await e.blob.text());
 await assert.rejects(IO.exportDirectory(target.root,entries),/必须为空/);
 const failed=memoryFS();failed.control.fail=(phase,path)=>phase==='write'&&path==='conversations-001.json'?new Error('disk failed'):null;await assert.rejects(IO.exportDirectory(failed.root,entries),/导出失败/);assert.equal(failed.files.size,0);
});
test('UI ZIP export supports selected scope without rebinding source or marking drafts saved',async()=>{
 const a=setup({editing:true}),rows=await loaded(a),r=rows.find(r=>r.id==='selected'),source=a.api.state.source;
 a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'UNSAVED TITLE'}]);a.api.openExport([r.key],'zip');a.document.getElementById('export-name').value='自定资料';await a.api.exportSelection();
 assert.equal(a.downloads.at(-1).name,'自定资料.zip');assert.equal(a.api.state.source,source);assert.equal(a.api.unsaved(),true);
 const b=setup({editing:true}),opened=await IO.zip(a.downloads.at(-1).blob);await b.api.loadEntries(opened.entries);assert.equal(b.api.state.records.length,1);assert.equal(b.api.state.records[0].raw.title,'UNSAVED TITLE');
});
test('UI folder export and ZIP picker export write copies without modifying current source',async()=>{
 const a=setup({editing:true}),rows=await loaded(a),source=a.api.state.source,folder=memoryFS(),zip=memoryFS();a.ctx.showDirectoryPicker=async()=>folder.root;a.ctx.showSaveFilePicker=async()=>zip.file('selected.zip');
 a.api.openExport([rows[0].key],'directory');await a.api.exportSelection();assert.ok(folder.files.has('selected/chat.html'));assert.equal(a.api.state.source,source);assert.equal(a.api.unsaved(),false);
 a.api.openExport([rows[0].key],'zip');await a.api.exportSelection();assert.ok(zip.files.get('selected.zip').size>0);assert.equal(a.api.state.source,source);
 const b=setup({editing:true});await b.api.loadEntries((await IO.zip(zip.files.get('selected.zip'))).entries);assert.equal(b.api.state.records.length,1);
});
test('cancelled chooser and unsupported folder API leave source and drafts intact',async()=>{
 const a=setup({editing:true}),rows=await loaded(a),source=a.api.state.source;a.api.openExport([rows[0].key],'directory');await a.api.exportSelection();assert.equal(a.document.getElementById('export-dialog').open,true);
 a.ctx.showDirectoryPicker=async()=>{throw Object.assign(new Error('cancelled'),{name:'AbortError'})};await a.api.exportSelection();assert.equal(a.api.state.source,source);assert.equal(a.downloads.length,0);assert.equal(a.api.state.busy,false);
});
test('invert selection affects the complete filtered list, preserves outside selections, and does not edit data',async()=>{
 const a=setup({editing:true}),rows=await loaded(a);a.api.state.selected.add(rows[0].key);a.api.state.selected.add(rows[2].key);a.api.state.visibleKeys=[rows[0].key,rows[1].key];a.document.getElementById('select-invert').click();
 assert.equal(a.api.state.multi,true);assert.equal(a.api.state.selected.has(rows[0].key),false);assert.equal(a.api.state.selected.has(rows[1].key),true);assert.equal(a.api.state.selected.has(rows[2].key),true);assert.equal(a.api.unsaved(),false);
});
test('two new quick icons and save-as icons are visually distinct and both formats allow all scopes',async()=>{
 const a=setup({editing:true});await loaded(a);const d=a.document;
 for(const [format,save]of [['directory','save-as-workspace'],['zip','save-as-zip-workspace']]){
  assert.notEqual(d.getElementById('quick-'+format).querySelector('svg').outerHTML,d.getElementById(save).querySelector('svg').outerHTML);
  d.getElementById('quick-'+format).click();assert.equal(d.getElementById('export-format').value,format);assert.equal(d.getElementById('export-layout-label').hidden,true);
  for(const [scope,n]of [['current',1],['all',3]]){d.getElementById('export-range').value=scope;assert.equal(a.api.exportRecords().length,n)}d.getElementById('export-dialog').close();
 }
});
test('exported subset can be edited and saved again while keeping portable chat.html synchronized',async()=>{
 const f=data();C.change(f.one,[0,'mapping','a','message','content','parts',0],'example: var jsonData = []');const entries=await E.bundle([f.rows[0]],f.resources,shell),a=setup({editing:true});await a.api.loadEntries(entries);const r=a.api.state.records[0];
 a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'SECOND EDIT'}]);const saved=await a.api.workspaceEntries(),json=saved.find(e=>e.path==='conversations-000.json'),page=saved.find(e=>e.path==='chat.html');
 assert.ok((await json.blob.text()).includes('SECOND EDIT'));assert.ok((await page.blob.text()).includes('SECOND EDIT'));assert.ok(!(await page.blob.text()).includes('OTHER-SENTINEL'));
});
test('export refuses the current ZIP destination even when the source was opened without a writable handle',async()=>{
 const a=setup({editing:true}),f=data(),blob=await IO.zipBlob(null,await E.bundle(f.rows,f.resources,shell)),opened=await a.ctx.ViewerStorage.zip(blob),target=memoryFS({'original.zip':new Uint8Array(await blob.arrayBuffer())});
 await a.api.loadEntries(opened.entries,null,opened.source);a.ctx.showSaveFilePicker=async()=>target.file('original.zip');a.api.openExport(undefined,'zip');await a.api.exportSelection();
 assert.equal(target.calls.length,0);assert.equal(a.document.getElementById('export-dialog').open,true);assert.equal(a.api.state.busy,false);
});
