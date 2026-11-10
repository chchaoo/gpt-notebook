
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const Zip=require('../vendor/jszip/jszip.min.js');
const metadata=path=>/^\.viewer-(?:state|backups)(?:\/|$)/.test(path);
const settings='.viewer-state/viewer-settings.json';
const chat=(id,title=id)=>({id,title,mapping:{}});
const archive=rows=>JSON.stringify(rows);
const files=values=>Object.entries(values).map(([path,value])=>({path,blob:new Blob([value])}));
const id=(a,name)=>a.document.getElementById(name);
const lastText=async (disk,path)=>await disk.files.get(path).text();
const titles=a=>Array.from(a.api.orderedRecords(),r=>r.raw.title);
const titleEdit=(a,row,value)=>a.api.commit([{doc:row.doc,path:[row.index,'title'],value}]);
async function openFolder(a,disk){
 const opened=await a.ctx.ViewerStorage.directory(disk.root);
 await a.api.loadEntries(opened.entries,null,opened.source);
 return a.api.state.records[0];
}
async function openZip(a,disk,path='export.zip'){
 const handle=disk.file(path),opened=await a.ctx.ViewerStorage.zip(await handle.getFile(),handle);
 await a.api.loadEntries(opened.entries,null,opened.source);
 return a.api.state.records[0];
}
function withAttachment(row,asset='file_12345678'){
 row.current_node='q';
 row.mapping.q={parent:null,message:{author:{role:'user'},content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'sediment://'+asset}]}}};
 return row;
}
const source=archive([chat('a','Alpha'),chat('b','Beta')]);

test('raw archive defaults off and the grey actions show the hint while viewing, selecting and exporting stay available',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source}),row=await openFolder(a,disk);
 assert.equal(id(a,'edit-mode').getAttribute('aria-checked'),'false');
 const star=a.document.querySelector('.conversation-star');
 assert.equal(star.nextElementSibling.className,'conversation-menu');
 for(const control of [id(a,'edit-title'),id(a,'undo'),id(a,'selection-import'),id(a,'menu-import'),id(a,'menu-star'),id(a,'backup-toggle'),star]){
   assert.equal(control.disabled,true);
   assert.equal(control.getAttribute('title'),'若要进行操作，请打开编辑模式');
 }
 id(a,'select-visible').click();assert.equal(a.api.state.selected.size,2);assert.equal(id(a,'selection-export').disabled,false);
 id(a,'sort-order').value='title';id(a,'sort-order').dispatchEvent(new a.document.defaultView.Event('change'));
 titleEdit(a,row,'unexpected');assert.equal(row.raw.title,'Alpha');
 assert.equal(a.api.unsaved(),false);assert.equal(await a.api.saveWorkspace(),true);
 assert.equal(disk.calls.length,0);assert.deepEqual([...disk.files.keys()],['conversations.json']);
 for(const format of ['zip','json','html']){
   a.api.openExport([row.key],format);await a.api.exportSelection();const output=a.downloads.at(-1).blob;
   if(format==='html')assert.doesNotMatch(await output.text(),/<script id="data"[^>]*>[^<]*\.viewer-state\//);
   else assert.ok(Object.keys((await Zip.loadAsync(await output.arrayBuffer())).files).every(path=>!metadata(path)));
 }
});

test('edited mode and stars are scoped to a folder and correctly rebound after deleting a preceding row',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source}),first=await openFolder(a,disk),second=a.api.state.records.find(r=>r.id==='b');
 assert.equal(await a.api.toggleEditMode(),true);
 titleEdit(a,second,'Edited Beta');a.api.toggleStar(second.key);
 assert.equal(id(a,'menu-star').disabled,false);
 await a.api.historyEdit('undo');assert.equal(a.api.state.stars.has(second.key),false);
 await a.api.historyEdit('redo');assert.equal(a.api.state.stars.has(second.key),true);
 a.api.deleteRecords([first.key]);assert.equal(await a.api.saveWorkspace(),true);
 assert.deepEqual(JSON.parse(await lastText(disk,settings)).stars,[{id:'b',path:'conversations.json',index:0}]);
 const b=setup();await openFolder(b,disk);
 assert.equal(id(b,'edit-mode').getAttribute('aria-checked'),'true');assert.equal(b.document.querySelector('.conversation-star').textContent,'★');assert.deepEqual(titles(b),['Edited Beta']);
 const c=setup();await openFolder(c,memoryFS({'conversations.json':source}));
 assert.equal(c.api.state.editMode,false);assert.equal(c.api.state.stars.size,0);
});

test('closing edit mode saves draft content and removes both metadata trees, including prior empty or unknown members',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source}),row=await openFolder(a,disk);
 await a.api.toggleEditMode();titleEdit(a,row,'First save');a.api.toggleStar(row.key);
 a.api.moveRecord(a.api.state.records[1].key,row.key);assert.equal(await a.api.saveWorkspace(),true);
 assert.ok([...disk.files.keys()].some(path=>path.startsWith('.viewer-backups/')));
 await disk.root.getDirectoryHandle('.viewer-backups').then(dir=>dir.getDirectoryHandle('empty',{create:true}));
 const stateDir=await disk.root.getDirectoryHandle('.viewer-state'),unknown=await stateDir.getFileHandle('unknown.json',{create:true});
 const writer=await unknown.createWritable();await writer.write(new Blob(['extra']));await writer.close();
 titleEdit(a,row,'Saved on close');
 a.ctx.confirm=()=>false;assert.equal(await a.api.toggleEditMode(),false);assert.equal(a.api.state.stars.size,1);
 a.ctx.confirm=()=>true;assert.equal(await a.api.toggleEditMode(),true);
 assert.equal(a.api.state.editMode,false);assert.equal(a.api.state.sort,'updated');assert.equal(a.api.state.stars.size,0);
 assert.ok([...disk.files.keys(),...disk.dirs].every(path=>!metadata(path)));
 assert.equal(JSON.parse(await lastText(disk,'conversations.json'))[0].title,'Saved on close');
 const b=setup();await openFolder(b,disk);assert.equal(b.api.state.editMode,false);
});

test('a failed directory removal rolls back chat, metadata and UI state, then can retry',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source}),row=await openFolder(a,disk);
 await a.api.toggleEditMode();titleEdit(a,row,'Saved');a.api.toggleStar(row.key);assert.equal(await a.api.saveWorkspace(),true);
 const before=new Map(await Promise.all([...disk.files].map(async ([path,blob])=>[path,await blob.text()])));
 titleEdit(a,row,'Pending');disk.control.fail=(phase,path)=>phase==='remove'&&path===settings?new Error('blocked'):null;
 assert.equal(await a.api.toggleEditMode(),false);assert.equal(a.api.state.editMode,true);assert.equal(a.api.state.stars.size,1);assert.equal(a.api.unsaved(),true);
 for(const [path,raw]of before)assert.equal(await lastText(disk,path),raw,path);
 disk.control.fail=null;assert.equal(await a.api.toggleEditMode(),true);assert.equal(JSON.parse(await lastText(disk,'conversations.json'))[0].title,'Pending');
});

test('clearing a directory fails atomically when its final hidden directory cannot be removed',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source}),row=await openFolder(a,disk);
 await a.api.toggleEditMode();a.api.toggleStar(row.key);assert.equal(await a.api.saveWorkspace(),true);
 const before=await lastText(disk,settings);titleEdit(a,row,'Draft');
 disk.control.fail=(phase,path)=>phase==='remove'&&path==='.viewer-state'?new Error('directory locked'):null;
 assert.equal(await a.api.toggleEditMode(),false);assert.equal(a.api.state.editMode,true);
 assert.equal(await lastText(disk,'conversations.json'),source);assert.equal(await lastText(disk,settings),before);
 disk.control.fail=null;assert.equal(await a.api.toggleEditMode(),true);
});

test('an archive whose last conversations are removed can reopen with edit mode off',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':source});
 await openFolder(a,disk);await a.api.toggleEditMode();
 a.api.deleteRecords(Array.from(a.api.state.records,r=>r.key));assert.equal(await a.api.toggleEditMode(),true);
 const b=setup();await openFolder(b,disk);assert.equal(id(b,'app').hidden,false);assert.equal(b.api.state.editMode,false);assert.equal(b.api.state.records.length,0);
 assert.ok([...disk.files.keys(),...disk.dirs].every(path=>!metadata(path)));
});

test('the off-mode Save As download contains the pending edits without viewer metadata',async()=>{
 const a=setup();
 await a.api.loadEntries(files({'conversations.json':source}),null,{kind:'embedded',name:'HTML',baseline:new Map()});
 await a.api.toggleEditMode();titleEdit(a,a.api.state.records[0],'In copy');
 assert.equal(await a.api.toggleEditMode(),true);assert.equal(a.api.state.editMode,false);assert.equal(a.api.state.downloadPending,true);
 const zip=await Zip.loadAsync(await a.downloads.at(-1).blob.arrayBuffer());
 assert.ok(Object.keys(zip.files).every(path=>!metadata(path)));
 assert.equal(JSON.parse(await zip.file('conversations.json').async('string'))[0].title,'In copy');
 id(a,'confirm-download').click();assert.equal(a.api.unsaved(),false);
});

test('a prefixed ZIP round trips edit mode and closing preserves sibling content and removes metadata members',async()=>{
 const a=setup(),zip=new Zip();
 zip.file('export/conversations.json',source);zip.file('export/user.json','untouched');zip.file('export/.viewer-backups/old/ignored.json','obsolete');
 const disk=memoryFS({'export.zip':await zip.generateAsync({type:'uint8array'})}),row=await openZip(a,disk);
 assert.equal(a.api.state.editMode,false);await a.api.toggleEditMode();titleEdit(a,row,'ZIP edit');a.api.toggleStar(row.key);
 assert.equal(await a.api.saveWorkspace(),true);
 const b=setup(),again=await openZip(b,disk);assert.equal(b.api.state.editMode,true);assert.equal(b.api.state.stars.has(again.key),true);
 assert.equal(await b.api.toggleEditMode(),true);
 const final=await Zip.loadAsync(await disk.files.get('export.zip').arrayBuffer());
 assert.ok(Object.keys(final.files).every(path=>!metadata(path.replace(/^export\//,''))));
 assert.equal(await final.file('export/user.json').async('string'),'untouched');
 assert.equal(JSON.parse(await final.file('export/conversations.json').async('string'))[0].title,'ZIP edit');
 const c=setup();await openZip(c,disk);assert.equal(c.api.state.editMode,false);
});

test('incremental import keeps exact raw numbers, appends divergent duplicates, copies only related media and updates a manifest',async()=>{
 const a=setup(),manifest='{"export_files":[{"path":"conversations.json","size_bytes":'+Buffer.byteLength(source)+'}],"logical_files":{"conversations.json":{"files":["conversations.json"],"sharded":false}},"unknown":900719925474099333}';
 const disk=memoryFS({'conversations.json':source,'export_manifest.json':manifest}),row=await openFolder(a,disk);
 const newer=withAttachment(chat('a','Different Alpha')),incoming=files({'conversations-002.json':'[\n'+JSON.stringify(chat('a','Alpha'),null,2)+','+JSON.stringify(newer).replace(/}$/,',"number":900719925474099333}')+']','images/file_12345678.dat':'media payload','images/file_87654321.png':'unused','library_files.json':'[{"file_id":"file_12345678","file_name":"Picture.png","mime_type":"image/png"}]','user.json':'incoming user'});
 assert.equal(await a.api.runImport(()=>incoming),false);await a.api.toggleEditMode();assert.equal(await a.api.saveWorkspace(),true);
 assert.equal(await a.api.runImport(()=>incoming),true);assert.equal(a.api.state.current,row.key);assert.equal(a.api.state.records.length,3);assert.equal(a.api.unsaved(),true);
 await a.api.historyEdit('undo');assert.deepEqual(titles(a),['Alpha','Beta']);assert.equal(a.api.unsaved(),false);
 const undoEntries=await a.api.workspaceEntries();assert.ok(undoEntries.every(e=>!e.path.includes('-import-')));
 await a.api.historyEdit('redo');assert.equal(a.api.orderedRecords().length,3);
 assert.equal(await a.api.saveWorkspace(),true);assert.equal(await lastText(disk,'conversations.json'),source);
 const paths=[...disk.files.keys()],shard=paths.find(p=>p.startsWith('conversations-import-')),media=paths.find(p=>p.endsWith('file_12345678.dat'));
 assert.match(await lastText(disk,shard),/900719925474099333/);assert.equal(await lastText(disk,media),'media payload');
 assert.ok(!paths.some(p=>p.endsWith('file_87654321.png')||p==='user.json'));
 const registered=await lastText(disk,'export_manifest.json');assert.match(registered,/900719925474099333/);
 assert.deepEqual(JSON.parse(registered).logical_files['conversations.json'],{files:['conversations.json',shard],sharded:true});
 const b=setup();await openFolder(b,disk);assert.equal(b.api.state.resources.get('file_12345678').name,'Picture.png');assert.equal(b.api.state.resources.get('file_12345678').mime,'image/png');
 assert.equal(await b.api.runImport(()=>incoming),false);assert.equal(b.api.state.records.length,3);
});

test('ZIP import picker uses the same draft path and a conflicting attachment or cancellation leaves the destination alone',async()=>{
 const a=setup(),disk=memoryFS({'conversations.json':archive([withAttachment(chat('a'))]),'file_12345678.png':'original'});
 await openFolder(a,disk);await a.api.toggleEditMode();await a.api.saveWorkspace();
 const before=a.api.state.docs.length;
 assert.equal(await a.api.runImport(()=>files({'conversations.json':archive([withAttachment(chat('c'))]),'file_12345678.png':'conflict'})),false);
 assert.equal(await a.api.runImport(()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'})}),false);
 assert.equal(a.api.state.docs.length,before);assert.equal(a.api.unsaved(),false);assert.equal(await lastText(disk,'file_12345678.png'),'original');
 const zip=new Zip();zip.file('conversations.json',archive([chat('new','ZIP import')]));
 const incoming=memoryFS({'incoming.zip':await zip.generateAsync({type:'uint8array'})});
 a.ctx.showOpenFilePicker=async()=>[incoming.file('incoming.zip')];
 id(a,'selection-import').click();assert.equal(id(a,'import-dialog').open,true);id(a,'import-zip').click();
 for(let i=0;a.api.state.busy&&i<50;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(titles(a).includes('ZIP import'));assert.equal(a.api.state.source.name,'archive');assert.equal(a.api.unsaved(),true);
});

test('Obsidian export creates resolvable index and attachment links and preserves math and code boundaries',async()=>{
 const a=setup(),row=chat('m','[Demo] #数学 (I)');row.current_node='a';
 const body=[
   'Inline '+String.raw`\(\frac{a}{b}\)` + ', currency $20, and existing $x^2$.',
   String.raw`\[`+'\n'+String.raw`\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}`+'\n'+String.raw`\]`,
   '$$\nx + y\n$$',
   'In code '+String.fromCharCode(96)+String.raw`\(leave\)`+String.fromCharCode(96)+'.',
   '~~~tex\n'+String.raw`\[leave\]`+'\n~~~',
   '~~~math\n'+String.raw`\sqrt{9}`+'\n~~~',
   '![local](data:image/png;base64,iVBORw0KGgo=)'
 ].join('\n\n');
 row.mapping.a={parent:null,message:{author:{role:'assistant'},content:{content_type:'multimodal_text',parts:[body,{content_type:'image_asset_pointer',asset_pointer:'sediment://file_12345678'}]}}};
 await a.api.loadEntries(files({'conversations.json':archive([row,chat('i','聊天索引')]),'file_12345678.png':'synthetic bytes'}));
 id(a,'quick-obsidian').click();assert.equal(id(a,'export-format').value,'obsidian');assert.equal(id(a,'export-layout-label').hidden,true);
 id(a,'export-range').value='all';await a.api.exportSelection();
 const zip=await Zip.loadAsync(await a.downloads.at(-1).blob.arrayBuffer()),index=await zip.file('聊天索引.md').async('string');
 const notePaths=Array.from(index.matchAll(/\]\(([^)]+)\)/g),m=>decodeURIComponent(m[1]));
 assert.equal(notePaths.length,2);assert.notEqual(notePaths[1],'聊天索引.md');
 const note=await zip.file(notePaths.find(p=>p.includes('Demo'))).async('string');
 assert.ok(note.includes(String.raw`$\frac{a}{b}$`));assert.ok(note.includes('currency $20, and existing $x^2$.'));
 assert.ok(note.includes('$$\n'+String.raw`\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}`+'\n$$'));
 assert.ok(note.includes('$$\nx + y\n$$'));assert.ok(note.includes('~~~tex\n'+String.raw`\[leave\]`+'\n~~~'));
 assert.ok(note.includes(String.fromCharCode(96)+String.raw`\(leave\)`+String.fromCharCode(96)));
 assert.ok(note.includes('$$\n'+String.raw`\sqrt{9}`+'\n$$'));
 for(const [,target]of note.matchAll(/!\[\[([^\]]+)\]\]/g))assert.ok(zip.file(target));
 for(const [,target]of note.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g))assert.ok(zip.file(decodeURIComponent(target)));
 assert.equal(Object.keys(zip.files).some(path=>path.startsWith('.obsidian')||metadata(path)),false);
 assert.equal(a.api.unsaved(),false);
});
