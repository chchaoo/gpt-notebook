const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../viewer_core.js'),E=require('../viewer_exports.js'),{setup}=require('./dom_checks.cjs');
const raw='[{"id":"a","title":"同名聊天","create_time":1,"update_time":3,"current_node":"n","mapping":{"n":{"parent":null,"message":{"author":{"role":"assistant"},"content":{"content_type":"text","parts":["first"]}}}},"huge":900719925474099333},{"id":"b","title":"同名聊天","create_time":2,"update_time":4,"current_node":"n","mapping":{"n":{"parent":null,"message":{"author":{"role":"assistant"},"content":{"content_type":"text","parts":["PRIVATE-B-EXCLUDE"]}}}}}]';
async function load(a){await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])},{path:'chat.html',blob:new Blob(['<script>var jsonData = '+raw+';var assetsJson = {}</script>'])}]);return a.api.state.records}
function records(){const doc=C.document(raw);doc.path='conversations.json';return doc.data.map((r,index)=>({raw:r,doc,index,key:String(index),id:r.id}))}
async function unzip(blob){const bytes=Buffer.from(await blob.arrayBuffer()),files=new Map();let p=0;while(bytes.readUInt32LE(p)===0x04034B50){const size=bytes.readUInt32LE(p+18),len=bytes.readUInt16LE(p+26),extra=bytes.readUInt16LE(p+28),name=bytes.subarray(p+30,p+30+len).toString('utf8'),start=p+30+len+extra;files.set(name,bytes.subarray(start,start+size));p=start+size}return files}
test('subset raw export includes unsaved edits, excludes other conversations and preserves large numbers',()=>{
 const rows=records();C.change(rows[0].doc,[0,'title'],'unsaved title');const output=E.selectedJSON([rows[0]]);
 assert.ok(output.includes('unsaved title'));assert.ok(output.includes('900719925474099333'));assert.ok(!output.includes('PRIVATE-B-EXCLUDE'));
});
test('portable HTML replaces the old payload and contains actual local media',async()=>{
 const rows=records(),assets=new Map([['file_12345678',{path:'file_12345678.dat',name:'photo.png',blob:new Blob([Uint8Array.from([1,2,3])])}]]);
 C.change(rows[0].doc,[0,'mapping','n','message','content','parts',0],'see file_12345678');
 const data=await E.payload([rows[0]],assets);assert.equal(data.archive.find(e=>e.path.endsWith('.dat')).base64,'AQID');
 const html=E.html('<html><script id="data" type="application/json">{"old":"PRIVATE-B-EXCLUDE"}</script></html>',data);
 assert.ok(!html.includes('PRIVATE-B-EXCLUDE'));assert.ok(html.includes('AQID'));assert.ok(html.includes('900719925474099333'));
});
test('Markdown extracts inserted image data into media files and resolves attachments',async()=>{
 const rows=records();C.change(rows[0].doc,[0,'mapping','n','message','content','parts',0],'edited ![image](data:image/png;base64,iVBORw0KGgo=)');
 rows[0].raw.mapping.n.message.metadata={attachments:[{id:'file_12345678',name:'a # (1).png',mime_type:'image/png'}]};
 const assets=new Map([['file_12345678',{path:'file_12345678.dat',blob:new Blob([new Uint8Array([1,2])],{type:'image/png'})}]]);
 const entries=await E.markdown([rows[0]],assets,{combined:true,name:'我的导出'});
 assert.equal(entries[0].path,'我的导出.md');const md=await entries[0].blob.text();assert.ok(md.includes('edited'));assert.ok(!md.includes('data:image'));assert.ok(md.includes('%23'));assert.equal(entries.filter(e=>e.path.startsWith('media/')).length,2);
});
test('separate title files handle duplicates and Windows reserved names',async()=>{
 const entries=await E.markdown(records(),new Map(),{combined:false});assert.deepEqual(entries.map(e=>e.path),['同名聊天.md','同名聊天 (2).md']);
 assert.equal(E.filename('CON'),'_CON');assert.equal(E.filename('a/b:c?'),'a_b_c_');
});
test('deletion is undoable and removes conversations from saved JSON and chat HTML',async()=>{
 const a=setup(),rows=await load(a),removed=rows.find(r=>r.id==='b');
 a.api.deleteRecords([removed.key]);assert.equal(a.api.orderedRecords().length,1);assert.equal(a.api.unsaved(),true);
 let files=await unzip(await a.api.workspaceArchive());assert.equal(JSON.parse(files.get('conversations.json')).length,1);assert.ok(!files.get('chat.html').toString().includes('PRIVATE-B-EXCLUDE'));
 a.api.historyEdit('undo');assert.equal(a.api.orderedRecords().length,2);
 a.api.historyEdit('redo');assert.equal(a.api.orderedRecords().length,1);
});
test('manual order is a sidecar setting and leaves original JSON and timestamps untouched',async()=>{
 const a=setup(),rows=await load(a),first=rows[0],second=rows[1],before=C.serialize(first.doc);
 a.api.moveRecord(second.key,first.key);assert.equal(a.api.orderedRecords()[0].key,second.key);assert.equal(C.serialize(first.doc),before);
 const files=await unzip(await a.api.workspaceArchive()),settings=JSON.parse(files.get('.viewer-state/viewer-settings.json'));
 assert.equal(settings.sort,'manual');assert.equal(settings.order[0].id,second.id);assert.equal(files.get('conversations.json').toString(),raw);
 const b=setup();await b.api.loadEntries([...files].map(([path,blob])=>({path,blob:new Blob([blob])})));assert.equal(b.api.orderedRecords()[0].id,second.id);
});
test('UI export dialog uses current unsaved draft for combined and separate HTML',async()=>{
 const a=setup(),rows=await load(a),r=rows.find(r=>r.id==='a');a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'new unsaved'}]);
 a.api.openExport([r.key]);a.document.getElementById('export-format').value='html';a.document.getElementById('export-layout').value='combined';a.document.getElementById('export-name').value='自定名称';
 await a.api.exportSelection();assert.equal(a.downloads[0].name,'自定名称.html');const html=await a.downloads[0].blob.text();assert.ok(html.includes('new unsaved'));assert.ok(!html.includes('PRIVATE-B-EXCLUDE'));
 a.api.openExport(rows.map(r=>r.key));a.document.getElementById('export-layout').value='separate';await a.api.exportSelection();const files=await unzip(a.downloads[1].blob);assert.equal(files.size,2);assert.ok(files.has('new unsaved.html'));
 assert.equal(a.api.unsaved(),true); // exporting does not mark the working document saved
});
module.exports={unzip};
