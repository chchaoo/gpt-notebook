
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const id=(a,name)=>a.document.getElementById(name);
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
const png=Uint8Array.of(137,80,78,71,13,10,26,10);
const chat={id:'sample',title:'Sample',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'multimodal_text',parts:['Synthetic chat',{content_type:'image_asset_pointer',asset_pointer:'sediment://file_12345678'}]}}}}};
async function open(){
 const a=setup();
 await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([chat])])},{path:'media/file_12345678.png',blob:new Blob([png])}]);
 return a;
}
async function until(fn){for(let i=0;i<75;i++){if(fn())return;await pause()}throw new Error('Progress did not reach expected phase')}

test('data folder export creates the requested child in a nonempty location and retains the source',async()=>{
 const a=await open(),disk=memoryFS({'keep.txt':'old','Sibling/keep.txt':'keep'}),source=a.api.state.source;
 a.ctx.showDirectoryPicker=async()=>disk.root;
 a.api.openExport(undefined,'directory');
 assert.equal(id(a,'export-name-label').hidden,false);
 assert.equal(id(a,'export-name-caption').textContent,'文件夹名称');
 id(a,'export-name').value='我的聊天 2026';
 await a.api.exportSelection();
 assert.equal(await disk.files.get('keep.txt').text(),'old');
 assert.ok(disk.files.has('Sibling/keep.txt'));
 const prefix='我的聊天 2026/';
 assert.equal(JSON.parse(await disk.files.get(prefix+'conversations.json').text())[0].id,'sample');
 assert.ok(disk.files.has(prefix+'chat.html'));
 assert.deepEqual(new Uint8Array(await disk.files.get(prefix+'media/file_12345678.png').arrayBuffer()),png);
 assert.equal(a.api.state.source,source);assert.equal(a.api.unsaved(),false);
 assert.equal(id(a,'operation-bar').value,100);
});

test('same-name folder or file, invalid names and cancellation do not overwrite or create anything',async()=>{
 const a=await open(),disk=memoryFS({'taken/file.txt':'preserve','file':'preserve'});let picks=0;
 a.ctx.showDirectoryPicker=async()=>{picks++;return disk.root};
 for(const name of ['TAKEN','File','../away','CON.txt','trail.','']){
  if(!id(a,'export-dialog').open)a.api.openExport(undefined,'directory');
  id(a,'export-name').value=name;await a.api.exportSelection();
  assert.equal(id(a,'export-dialog').open,true);
  assert.equal(a.api.state.busy,false);assert.equal(id(a,'export-cancel').disabled,false);
 }
 assert.equal(picks,2);
 a.ctx.showDirectoryPicker=async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'})};
 id(a,'export-name').value='New';await a.api.exportSelection();
 assert.deepEqual([...disk.files.keys()],['taken/file.txt','file']);assert.equal(disk.dirs.has('New'),false);
});

test('failed nested writes remove the output folder without touching parent contents, then retry',async()=>{
 const a=await open(),disk=memoryFS({'keep.txt':'untouched'});
 a.ctx.showDirectoryPicker=async()=>disk.root;
 a.api.openExport(undefined,'directory');id(a,'export-name').value='Output';
 disk.control.fail=(phase,path)=>phase==='write'&&path==='Output/media/file_12345678.png'?new Error('disk full'):null;
 await a.api.exportSelection();
 assert.deepEqual([...disk.files.keys()],['keep.txt']);assert.deepEqual([...disk.dirs],['']);
 assert.equal(id(a,'export-dialog').open,true);
 disk.control.fail=null;await a.api.exportSelection();
 assert.ok(disk.files.has('Output/media/file_12345678.png'));
});

test('each downloadable export displays progress before content generation and reports completion',async()=>{
 for(const [format,layout]of [['html','combined'],['html','separate'],['markdown','combined'],['obsidian','combined'],['json','separate'],['zip','combined']]){
  const a=await open();
  a.api.openExport(undefined,format);
  id(a,'export-layout').value=layout;
  const task=a.api.exportSelection();
  assert.equal(id(a,'operation-progress').hidden,false,format);
  assert.equal(id(a,'operation-progress').parentElement,id(a,'export-dialog'));
  assert.equal(id(a,'operation-label').textContent,'准备导出');
  assert.equal(id(a,'export-cancel').disabled,true);
  await task;
  assert.equal(a.downloads.length,1,format);
  assert.equal(id(a,'operation-bar').value,100);
  assert.equal(id(a,'operation-label').textContent,'导出完成 100%');
  assert.equal(a.api.state.busy,false);
 }
});

test('directory picker waiting and writes use the same progress panel',async()=>{
 const a=await open(),disk=memoryFS();let release;
 const chosen=new Promise(resolve=>release=resolve);
 a.ctx.showDirectoryPicker=()=>chosen;
 a.api.openExport(undefined,'directory');const pending=a.api.exportSelection();
 assert.equal(id(a,'operation-label').textContent,'等待选择导出位置');
 assert.equal(id(a,'operation-bar').hasAttribute('value'),false);
 const original=a.ctx.ViewerStorage.exportSubdirectory;let checked=false;
 a.ctx.ViewerStorage.exportSubdirectory=(parent,name,entries,report)=>original(parent,name,entries,(stage,percent)=>{
  report(stage,percent);
  if(stage==='写入导出文件'&&percent===100){checked=true;assert.equal(id(a,'operation-bar').value,100)}
 });
 release(disk.root);await pending;assert.equal(checked,true);
});

test('PDF and print report preparation until the native dialog takes over',async()=>{
 for(const pdf of [true,false]){
  const a=await open();let handoff=false,ready;
  const fontsReady=new Promise(resolve=>ready=resolve);
  Object.defineProperty(a.document,'fonts',{value:{ready:fontsReady},configurable:true});
  a.ctx.print=()=>{handoff=true;assert.equal(id(a,'operation-label').textContent,'打开系统打印窗口')};
  a.api.openPrint(pdf);const task=a.api.startPrint();
  assert.equal(id(a,'operation-label').textContent,'准备打印');
  await until(()=>id(a,'operation-label').textContent==='加载打印字体和图片');
  assert.equal(id(a,'print-cancel').disabled,true);assert.equal(handoff,false);
  ready();await task;
  assert.equal(handoff,true);assert.equal(a.api.state.busy,false);assert.equal(id(a,'print-cancel').disabled,false);
 }
});
