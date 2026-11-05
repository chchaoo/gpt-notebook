const {test}=require('node:test'),assert=require('node:assert/strict');
const Factory=require('../viewer_editor.js');
const {setup}=require('./dom_checks.cjs');
const {memoryFS}=require('./memory_fs.cjs');
test('rich editor retains original text when untouched and disables telemetry',()=>{
 let options,instance;class Fake{constructor(o){options=o;this.value=o.initialValue.trim();instance=this}getMarkdown(){return this.value}destroy(){}focus(){}}
 const api=Factory({toastui:{Editor:Fake}}),original='**test**\n\n',editor=api.create({},original,()=>{});
 assert.equal(editor.get(),original);assert.equal(options.usageStatistics,false);assert.ok(options.toolbarItems.flat().includes('image'));
 instance.value='## changed';assert.equal(editor.get(),'## changed');
});
test('image insertion is local data with raster validation',async()=>{
 const api=Factory({btoa:s=>Buffer.from(s,'binary').toString('base64')});
 const png=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])]);
 assert.ok((await api.imageData(png)).startsWith('data:image/png;base64,'));
 await assert.rejects(api.imageData(new Blob(['<svg></svg>'],{type:'image/svg+xml'})));
});
async function load(a){await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([{id:'test',title:'original',mapping:{}}])])}]);return a.api.state.records[0]}
test('Save binds and writes the original directory, reuses handle, Save As chooses ZIP',async()=>{
 const a=setup(),record=await load(a),original=await a.api.state.entries.get('conversations.json').blob.text(),fs=memoryFS({'conversations.json':original,'new.zip':''});let picks=0;
 // Keep the original opened file list identical when granting write access.
 fs.files.delete('new.zip');a.ctx.showDirectoryPicker=async()=>{picks++;return fs.root};
 a.api.commit([{doc:record.doc,path:[0,'title'],value:'pending'}]);assert.equal(a.api.unsaved(),true);
 assert.equal(await a.api.saveWorkspace(),true);assert.equal(a.api.unsaved(),false);assert.equal(picks,1);
 a.api.commit([{doc:record.doc,path:[0,'title'],value:'more edits'}]);await a.api.saveWorkspace();assert.equal(picks,1);
 assert.equal(JSON.parse(await fs.files.get('conversations.json').text())[0].title,'more edits');
 a.ctx.showSaveFilePicker=async()=>{picks++;return fs.root.getFileHandle('new.zip',{create:true})};
 assert.equal(await a.api.saveAsChoice('zip'),true);assert.equal(picks,2);assert.equal(a.api.state.source.kind,'zip');assert.equal(a.api.unsaved(),false);
});
test('cancelled save and failed write retain unsaved draft',async()=>{
 const a=setup(),record=await load(a);a.api.commit([{doc:record.doc,path:[0,'title'],value:'pending'}]);
 a.ctx.showDirectoryPicker=async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'})};
 assert.equal(await a.api.saveWorkspace(),false);assert.equal(a.api.unsaved(),true);
 const fs=memoryFS({'draft.zip':''});fs.control.fail=(phase,path)=>phase==='write'?new Error('disk full'):null;a.ctx.showSaveFilePicker=async()=>fs.file('draft.zip');
 await a.api.saveWorkspace(true);await a.api.saveAsChoice('zip');assert.equal(a.api.unsaved(),true);assert.equal(record.raw.title,'pending');
});
test('close-workspace dialog offers save, save-as, discard and cancel',async()=>{
 const a=setup(),record=await load(a);a.api.commit([{doc:record.doc,path:[0,'title'],value:'pending'}]);
 const dialog=a.document.getElementById('leave-dialog');dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 a.api.requestClose();assert.equal(dialog.open,true);
 for(const name of ['leave-save','leave-save-as','leave-discard','leave-cancel'])assert.ok(a.document.getElementById(name));
 a.document.getElementById('leave-cancel').click();assert.equal(a.api.state.records.length,1);assert.equal(a.api.unsaved(),true);
 a.document.getElementById('leave-discard').click();assert.equal(a.api.state.records.length,0);
});
test('unsupported in-place Save refuses to pretend success; explicit Save As download needs confirmation',async()=>{
 const a=setup(),r=await load(a);a.api.commit([{doc:r.doc,path:[0,'title'],value:'draft one'}]);
 assert.equal(await a.api.saveWorkspace(),false);assert.equal(a.downloads.length,0);await a.api.saveWorkspace(true);await a.api.saveAsChoice('zip');assert.equal(a.api.unsaved(),true);assert.equal(a.api.state.downloadPending,true);
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'draft two'}]);
 a.document.getElementById('confirm-download').click();assert.equal(a.api.unsaved(),true);
 await a.api.saveWorkspace(true);await a.api.saveAsChoice('zip');a.document.getElementById('confirm-download').click();assert.equal(a.api.unsaved(),false);
});
test('opening a new workspace never carries over the previous save handle',async()=>{
 const a=setup();await load(a);const marker={};a.api.state.fileHandle=marker;
 await a.api.loadEntries([{path:'conversations.json',blob:new Blob(['[{"id":"next","title":"next","mapping":{}}]'])}]);
 assert.equal(a.api.state.fileHandle,null);
});
