const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const H='.viewer-state/viewer-history.json',S='.viewer-state/viewer-settings.json';
const raw=JSON.stringify([{id:'one',title:'one',current_node:'n',mapping:{n:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['hello']}}}}}]);
async function open(a,fs){const x=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records[0]}
function edit(a,r,value='two'){a.api.commit([{doc:r.doc,path:[r.index,'title'],value}])}
async function legacy(){const fs=memoryFS({'conversations.json':raw}),a=setup(),r=await open(a,fs);edit(a,r);assert.equal(await a.api.saveWorkspace(),true);for(const path of [H,S]){fs.files.set(path.split('/').at(-1),fs.files.get(path));fs.files.delete(path)}return fs}

test('new saves keep control files in a dot directory and leave the original manifest byte-identical when sizes do not change',async()=>{
 const manifest='{ "export_files": [{"path":"conversations.json","size_bytes":'+Buffer.byteLength(raw)+'}], "logical_files":{"conversations.json":{"files":["conversations.json"],"sharded":false}}, "unknown":900719925474099333 }';
 const fs=memoryFS({'conversations.json':raw,'export_manifest.json':manifest}),a=setup(),r=await open(a,fs);assert.equal(fs.files.has(H),false);edit(a,r);assert.equal(await a.api.saveWorkspace(),true);
 assert.deepEqual([...fs.files.keys()].filter(p=>!p.startsWith('.viewer-backups/segments/')).sort(),[H,S,'conversations.json','export_manifest.json']);assert.equal(await fs.files.get('export_manifest.json').text(),manifest);
 const b=setup();await open(b,fs);assert.equal(b.api.journal.has(b.api.state.records[0].historyUid),true);assert.equal(b.api.unsaved(),false);
});

test('legacy root history and settings migrate on explicit Save without rewriting unchanged conversations',async()=>{
 const fs=await legacy(),old=await fs.files.get('viewer-history.json').text(),a=setup(),r=await open(a,fs);assert.equal(a.api.unsaved(),true);assert.equal(fs.files.has(H),false);assert.equal(a.api.journal.has(r.historyUid),true);const start=fs.calls.length;
 assert.equal(await a.api.saveWorkspace(),true);assert.equal(fs.files.has('viewer-history.json'),false);assert.equal(fs.files.has('viewer-settings.json'),false);assert.equal(fs.files.has(H),true);assert.equal(fs.calls.slice(start).some(([phase,p])=>phase==='open'&&p==='conversations.json'),false);
 const b=setup(),row=await open(b,fs),v=b.api.journal.data.records[row.historyUid].versions[0];assert.equal(JSON.parse(b.api.journal.target(row.historyUid,v.id)).title,'one');assert.ok(JSON.parse(old).head);
});

test('migrating removes only viewer manifest registrations and preserves unknown large-number tokens',async()=>{
 const fs=await legacy();fs.files.set('export_manifest.json',new Blob(['{"export_files":[{"path":"conversations.json","size_bytes":'+Buffer.byteLength(raw)+'},{"path":"viewer-history.json","size_bytes":1},{"path":"viewer-settings.json","size_bytes":1}],"logical_files":{"conversations.json":{"n":900719925474099333},"viewer-history.json":{},"viewer-settings.json":{}},"custom":900719925474099333}']));
 const a=setup();await open(a,fs);assert.equal(await a.api.saveWorkspace(),true);const text=await fs.files.get('export_manifest.json').text(),manifest=JSON.parse(text);assert.deepEqual(manifest.export_files.map(e=>e.path),['conversations.json']);assert.deepEqual(Object.keys(manifest.logical_files),['conversations.json']);assert.equal((text.match(/900719925474099333/g)||[]).length,2);
});

test('failed removal of a legacy file rolls back earlier removals and all new control files, and can retry',async()=>{
 const fs=await legacy(),before=new Map(await Promise.all([...fs.files].map(async([p,b])=>[p,await b.text()]))),a=setup();await open(a,fs);fs.control.fail=(phase,p)=>phase==='remove'&&p==='viewer-settings.json'?new Error('locked'):null;
 assert.equal(await a.api.saveWorkspace(),false);assert.deepEqual([...fs.files.keys()].sort(),[...before.keys()].sort());for(const [p,text]of before)assert.equal(await fs.files.get(p).text(),text);fs.control.fail=null;assert.equal(await a.api.saveWorkspace(),true);
});

test('an external change to legacy history prevents migration without overwriting it',async()=>{
 const fs=await legacy(),a=setup();await open(a,fs);fs.files.set('viewer-history.json',new Blob(['external']));assert.equal(await a.api.saveWorkspace(),false);assert.equal(await fs.files.get('viewer-history.json').text(),'external');assert.equal(fs.files.has(H),false);
});

test('prefixed ZIP migration removes old root files and reopens all history from the private directory',async()=>{
 const fs=await legacy(),a=setup(),zip=new a.ctx.JSZip();for(const [p,b]of fs.files)zip.file('export/'+p,await b.text());zip.file('export/.viewer-backups/old/conversations.json','old snapshot');
 const disk=memoryFS({'data.zip':await zip.generateAsync({type:'uint8array'})}),opened=await a.ctx.ViewerStorage.zip(await disk.file('data.zip').getFile(),disk.file('data.zip'));await a.api.loadEntries(opened.entries,null,opened.source);assert.equal(a.api.state.records.length,1);assert.equal(await a.api.saveWorkspace(),true);
 const saved=await require('../vendor/jszip/jszip.min.js').loadAsync(await disk.files.get('data.zip').arrayBuffer());assert.ok(saved.file('export/'+H));assert.equal(saved.file('export/viewer-history.json'),null);assert.equal(saved.file('export/viewer-settings.json'),null);assert.ok(saved.file('export/.viewer-backups/old/conversations.json'));
 const b=setup(),again=await b.ctx.ViewerStorage.zip(disk.files.get('data.zip'));await b.api.loadEntries(again.entries,null,again.source);assert.equal(b.api.state.records.length,1);assert.equal(b.api.journal.has(b.api.state.records[0].historyUid),true);
});

test('subset data bundles keep settings private, exclude unrelated history and do not register metadata in the original manifest',async()=>{
 const a=setup(),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);edit(a,r);await a.api.saveWorkspace();const entries=await a.ctx.ViewerExports.bundle([r],a.api.state.resources,'<script id="data" type="application/json">null</script>'),map=new Map(entries.map(e=>[e.path,e.blob]));
 assert.ok(map.has(S));assert.equal(map.has(H),false);assert.equal(map.has('viewer-settings.json'),false);const manifest=JSON.parse(await map.get('export_manifest.json').text());assert.equal(manifest.export_files.some(e=>e.path.startsWith('.viewer-backups/')),false);assert.equal(Object.keys(manifest.logical_files).some(p=>p.startsWith('.viewer-backups/')),false);
});

test('divergent duplicate metadata is never silently deleted or overwritten',async()=>{
 const fs=await legacy();fs.files.set(H,new Blob(['{"version":141,"enabled":false,"records":{},"bindings":[],"orders":[]}']));const before=await fs.files.get('viewer-history.json').text(),a=setup();await open(a,fs);assert.equal(await a.api.saveWorkspace(),false);assert.equal(await fs.files.get('viewer-history.json').text(),before);
});
