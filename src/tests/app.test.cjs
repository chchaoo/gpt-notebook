/* Integration against the real UI functions with an in-memory DOM adapter.
   This is not a browser layout/permission test. Markdown policy has its own tests. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const C=require('../viewer_core.js');
class Element {
  constructor(tag='div',type=1){this.tagName=tag.toUpperCase();this.nodeType=type;this.children=[];this.dataset={};this.events={};this.attrs={};this._text='';this._class='';this.scrollTop=0;this.value='';this.checked=false;this.hidden=false;this.open=false;this.isConnected=true;
    this.classList={contains:c=>this._class.split(' ').includes(c),toggle:(c,v)=>{const values=new Set(this._class.split(' ').filter(Boolean));const yes=v===undefined?!values.has(c):v;yes?values.add(c):values.delete(c);this._class=[...values].join(' ');},remove:c=>this.classList.toggle(c,false)};
    if(tag==='template')this.content=new Element('fragment',11);
  }
  set className(value){this._class=value} get className(){return this._class}
  set textContent(value){this._text=String(value??'');this.children=[]} get textContent(){return this._text+this.children.map(x=>x.textContent).join('')}
  set innerHTML(value){this.content.replaceChildren(new Element('#text',3));this.content.children[0].textContent=value}
  get childNodes(){return this.children}
  append(...items){for(let item of items){if(typeof item==='string'){const n=new Element('#text',3);n.textContent=item;item=n}if(item.nodeType===11)this.append(...item.children);else{item.parent=this;this.children.push(item)}}}
  prepend(item){item.parent=this;this.children.unshift(item)}
  replaceChildren(...items){this.children=[];this._text='';this.append(...items)}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  replaceWith(item){if(this.parent){const i=this.parent.children.indexOf(this);this.parent.children[i]=item;item.parent=this.parent}}
  setAttribute(k,v){this.attrs[k]=v} getAttribute(k){return this.attrs[k]??null}
  addEventListener(type,cb){(this.events[type]||=[]).push(cb)}
  removeEventListener(type,cb){this.events[type]=(this.events[type]||[]).filter(fn=>fn!==cb)}
  async trigger(type){for(const fn of this.events[type]||[])await fn({target:this,preventDefault(){}})}
  querySelectorAll(selector){const list=[];for(const c of this.children){if(selector.startsWith('.')?c.className.split(' ').includes(selector.slice(1)):c.tagName.toLowerCase()===selector)list.push(c);list.push(...c.querySelectorAll(selector))}return list}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  showModal(){this.open=true} close(){this.open=false} focus(){} click(){if(this.tagName==='A'&&this.download)this.onDownload?.(this.href,this.download);return this.trigger('click')}
}
function setup(){
  const ids={},body=new Element('body'), downloads=[],urls=new Map();
  const id=name=>ids[name] ||= new Element(name==='branch'?'select':'div');
  for(const direction of ['undo','redo'])id(direction+'-menu').append(new Element('summary'));
  const manual=new Element('option');id('sort-order').querySelector=()=>manual;
  const doc={body,documentElement:{outerHTML:'<html><script id="data" type="application/json">null</script></html>',style:{setProperty(){}}},getElementById:id,createElement(tag){const e=new Element(tag);if(tag==='a')e.onDownload=(url,name)=>downloads.push({blob:urls.get(url),name});return e},createTextNode(value){const e=new Element('#text',3);e.textContent=value;return e},createDocumentFragment:()=>new Element('fragment',11),querySelectorAll:s=>body.querySelectorAll(s),addEventListener(){}};
  id('data').textContent='null';id('app').hidden=true;
  const ctx={ViewerCore:C,ViewerJournal:require('../viewer_journal.js'),ViewerJournalStore:require('../viewer_journal_store.js'),ViewerHistory:require('../viewer_history.js'),ViewerOutline:require('../viewer_outline.js'),ViewerTitleIndex:require('../viewer_title_index.js'),ViewerStorage:require('../viewer_storage.js')(C,require('../vendor/jszip/jszip.min.js')),ViewerSearch:require('../viewer_search.js'),ViewerI18n:{t:x=>x,locale:()=> 'zh-CN',observe(){},setText:(el,value)=>{el.textContent=value;return el},setAttribute:(el,key,value)=>el.setAttribute(key,value)},ViewerPrint:require('../viewer_print.js')(C,require('../viewer_exports.js')),ViewerExports:require('../viewer_exports.js'),ViewerNavigation:require('../viewer_navigation.js'),ViewerTransfer:require('../viewer_transfer.js'),ViewerMarkdown:{render:value=>value},document:doc,Node:{TEXT_NODE:3,ELEMENT_NODE:1},Blob,TextEncoder,TextDecoder,setTimeout:(f,n)=>n>=60000?0:setTimeout(f,n),clearTimeout,
    URL:{createObjectURL(blob){const url='blob:test'+urls.size;urls.set(url,blob);return url},revokeObjectURL:url=>urls.delete(url)},
    location:{hash:''},history:{pushState(){}},navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,console,
    atob:value=>Buffer.from(value,'base64').toString('binary')};
  ctx.window=ctx;ctx.addEventListener=()=>{};
  let source=fs.readFileSync(path.join(__dirname,'../viewer_app.js'),'utf8');
  source=source.replace('state.editMode=Boolean(settings||controlEntry(ViewerJournalStore.path));','state.editMode=true;');
  source=source.replace('updateChanges(); loadBaked();','globalThis.api={state,loadEntries,loadBaked,commit,historyEdit,renderCurrent,renderList,workspaceArchive,editMessage,editTitle,sniff};updateChanges();');
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {api:ctx.api,id,downloads};
}
const fixture=()=>fs.readdirSync(path.join(__dirname,'fixture')).map(name=>({path:name,blob:new Blob([fs.readFileSync(path.join(__dirname,'fixture',name))])}));
test('UI load, tool switch, branch switch, full recap, editing and undo/redo',async()=>{
  const {api,id}=setup();await api.loadEntries(fixture());
  assert.equal(api.state.records.length,1);assert.equal(id('app').hidden,false);
  assert.equal(id('msgs').querySelectorAll('article').length,2);
  id('show-tool').checked=true;await id('show-tool').trigger('change');
  assert.equal(id('msgs').querySelectorAll('article').length,4);
  id('show-thoughts').checked=true;await id('show-thoughts').trigger('change');
  const recap=id('msgs').querySelectorAll('details').find(d=>d.className==='thought-block');
  recap.open=true;await recap.trigger('toggle');assert.ok(recap.textContent.includes('【摘要末尾：现在可以完整看到】'));
  const record=api.state.records[0];api.state.branches.set(record.key,'old');await api.renderCurrent();
  assert.ok(id('msgs').textContent.includes('旧分支回答'));assert.ok(!id('msgs').textContent.includes('答案是'));
  api.commit([{doc:record.doc,path:[0,'title'],value:'edited'}]);assert.equal(record.raw.title,'edited');
  api.historyEdit('undo');assert.ok(record.raw.title.startsWith('修复版'));api.historyEdit('redo');assert.equal(record.raw.title,'edited');
  assert.ok(C.serialize(record.doc).includes('900719925474099333'));
});
test('editor dialog applies the correct original message field',async()=>{
  const {api,id}=setup();await api.loadEntries(fixture());const r=api.state.records[0];
  api.editMessage(r,'q',r.raw.mapping.q.message);assert.equal(id('editor').open,true);
  const input=id('edit-fields').querySelectorAll('textarea')[0];input.value='new question';
  id('save-edit').onclick();assert.equal(id('editor').open,false);
  assert.equal(r.raw.mapping.q.message.content.parts[0],'new question');
  assert.equal(r.doc.changes.size,1);
});
test('complete ZIP synchronizes chat.html, includes attachments, updates manifest sizes',async()=>{
  const {api,downloads}=setup();await api.loadEntries(fixture());const r=api.state.records[0];
  api.commit([{doc:r.doc,path:[0,'title'],value:'导出后的标题'}]);
  const archive=await api.workspaceArchive();downloads.push({blob:archive,name:'workspace.zip'});assert.equal(downloads.length,1);assert.ok(downloads[0].name.endsWith('.zip'));
  const bytes=Buffer.from(await downloads[0].blob.arrayBuffer()),files=new Map();let pos=0;
  while(bytes.readUInt32LE(pos)===0x04034B50){const size=bytes.readUInt32LE(pos+18),nameLength=bytes.readUInt16LE(pos+26),extra=bytes.readUInt16LE(pos+28);const name=bytes.subarray(pos+30,pos+30+nameLength).toString('utf8'),start=pos+30+nameLength+extra;
    files.set(name,bytes.subarray(start,start+size));pos=start+size;}
  const json=files.get('conversations.json').toString('utf8');assert.equal(JSON.parse(json)[0].title,'导出后的标题');assert.ok(json.includes('900719925474099333'));
  assert.ok(files.get('chat.html').toString('utf8').includes('导出后的标题'));
  assert.deepEqual(files.get('file_12345678.dat'),fs.readFileSync(path.join(__dirname,'fixture/file_12345678.dat')));
  const manifest=JSON.parse(files.get('export_manifest.json'));for(const entry of manifest.export_files)assert.equal(entry.size_bytes,files.get(entry.path).length);
  // Reimport the exported archive entries through the production load path.
  const next=setup();await next.api.loadEntries([...files].map(([path,data])=>({path,blob:new Blob([data])})));
  assert.equal(next.api.state.records[0].raw.title,'导出后的标题');
});
test('resource MIME sniffing recognizes .dat image bytes',()=>{
  const {api}=setup();const png=fs.readFileSync(path.join(__dirname,'fixture/file_12345678.dat'));assert.equal(api.sniff(png),'image/png');
});
test('invalid imported records are retained for export, duplicate IDs stay addressable',async()=>{
  const {api,id}=setup();const c={id:'same',mapping:{},title:'a'};
  const source='['+JSON.stringify(c)+','+JSON.stringify(c)+',null]';
  await api.loadEntries([{path:'conversations.json',blob:new Blob([source])}]);
  assert.equal(api.state.records.length,2);assert.notEqual(api.state.records[0].key,api.state.records[1].key);
  assert.equal(C.serialize(api.state.docs[0]),source);assert.ok(id('warnings').textContent.includes('重复'));
});
test('baked startup restores embedded attachment bytes and raw source text',async()=>{
  const {api,id}=setup();
  const html=fs.readFileSync(path.join(__dirname,'browser-check.html'),'utf8');
  id('data').textContent=/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  await api.loadBaked();
  assert.equal(api.state.records.length,1);
  assert.deepEqual(Buffer.from(await api.state.entries.get('file_12345678.dat').blob.arrayBuffer()),fs.readFileSync(path.join(__dirname,'fixture/file_12345678.dat')));
  assert.equal(C.serialize(api.state.docs[0]),fs.readFileSync(path.join(__dirname,'fixture/conversations.json'),'utf8'));
});
