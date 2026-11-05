/* Offline DOM integration, no browser navigation or network access. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let base=__dirname,DOM;try{DOM=require('linkedom')}catch(_){}
while(base!==path.dirname(base)){const p=path.join(base,'测试依赖/node_modules/linkedom');if(fs.existsSync(p)){DOM=require(p);break}base=path.dirname(base)}
if(!DOM)throw Error('DOM checks need linkedom in the shared test dependencies');
const C=require('../viewer_core.js'),N=require('../viewer_navigation.js'),T=require('../viewer_transfer.js');
function setup(options={}){
  const {window,document}=DOM.parseHTML(fs.readFileSync(path.join(__dirname,'../viewer_template.html'),'utf8'));
  const downloads=[],urls=new Map(),originalCreate=document.createElement.bind(document);
  document.createElement=(tag,...args)=>{const el=originalCreate(tag,...args);if(tag.toLowerCase()==='a')el.addEventListener('click',()=>{if(el.download)downloads.push({name:decodeURIComponent(el.download),blob:urls.get(el.href)})});return el};
  Object.defineProperty(document,'compatMode',{value:'CSS1Compat'});
  document.getElementById('data').textContent='null';
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const o of this.querySelectorAll('option')){if(o.value===value)o.setAttribute('selected','');else o.removeAttribute('selected')}}});
  window.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='1'};
  for(const e of document.querySelectorAll('#chat-container,.conv-list'))e.scrollTop=0;
  for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false}
  const ctx={document,Node:window.Node,Blob,TextEncoder,TextDecoder,URL:{createObjectURL:blob=>{const url='blob:local'+urls.size;urls.set(url,blob);return url},revokeObjectURL(){}},setTimeout:(f,n,...args)=>n>=60000?0:setTimeout(f,n,...args),clearTimeout,console,
    history:{pushState(){}},location:{hash:''},confirm:()=>true,navigator:{language:'zh-CN',clipboard:{writeText:async()=>{}}},addEventListener(){},atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),localStorage:{getItem(){return null},setItem(){}},matchMedia:options.matchMedia||(()=>({matches:false,addEventListener(){}}))};
  ctx.window=ctx.self=ctx;vm.createContext(ctx);
  for(const file of ['viewer_core.js','vendor/jszip/jszip.min.js','viewer_storage.js','vendor/re2js/build/index.umd.js','viewer_search.js','viewer_i18n.js','viewer_navigation.js','viewer_transfer.js','viewer_exports.js','marked.min.js','vendor/katex/dist/katex.min.js','viewer_markdown.js','viewer_print.js','vendor/pinyin-pro/dist/index.js','viewer_title_index.js','viewer_outline.js','viewer_history.js','viewer_journal.js','viewer_journal_store.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
  let app=fs.readFileSync(path.join(__dirname,'../viewer_app.js'),'utf8');
  app=app.replace('updateChanges(); loadBaked();','globalThis.api={state,selectRecord,loadEntries,renderList,renderCurrent,navigateSearch,commit,historyEdit,editMessage,plainText,saveWorkspace,saveAsChoice,workspaceEntries,audit,selectRange,showChanges,focusHistoryTarget,jumpToTurn,turnOutline,startPrint,openPrint,applySidebarWidth,unsaved,requestClose,closeWorkspace,openExport,exportRecords,exportSelection,deleteRecords,orderedRecords,moveRecord,workspaceArchive,journal,showBackups,restoreBackup,deleteBackup,backupSnapshot};updateChanges();');
  vm.runInContext(app,ctx);return {api:ctx.api,document,ctx,downloads,urls};
}
async function main(){
  const a=setup(),q='信号';
  const c={id:'demo',title:'信号学习与信号处理',current_node:'new',mapping:{
    q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['解释信号']},create_time:1}},
    old:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['其他分支的信号']},create_time:2}},
    new:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:['信号 **信号**\n\n\\[ I=\\int_0^{3+i}z^2\\,dz \\]\n\n:::writing{variant="document" id="1"}\n正文\n:::']},create_time:3}}
  }};
  await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify([c])])}]);
  assert.ok(a.document.querySelector('.katex'));assert.ok(!a.document.querySelector('#msgs').textContent.includes(':::writing'));
  a.document.getElementById('search').value=q;await a.api.renderList();
  assert.equal(a.document.querySelectorAll('.conv-title mark').length,2);
  a.document.getElementById('search-body').checked=true;await a.api.renderList();
  assert.equal(a.api.state.search.hits.length,6);
  await a.api.navigateSearch(-1);assert.equal(a.api.state.search.cursor,5);
  await a.api.navigateSearch(1);assert.equal(a.api.state.search.cursor,0);
  await a.api.navigateSearch(1);await a.api.navigateSearch(1);await a.api.navigateSearch(1);
  assert.ok(a.document.querySelector('mark.current-hit'));
  // Actual DOM highlighter handles a search term spanning formatting boundaries.
  const el=a.document.createElement('p');el.innerHTML='hello <strong>world</strong>';a.document.body.append(el);
  const marks=N.highlight(el,'hello world');assert.equal(marks.length,1);assert.equal(el.querySelectorAll('mark').length,2);N.clear(el);assert.equal(el.textContent,'hello world');
  // Capture and restore the same visible paragraph after an insertion above it.
  const scroll=a.document.createElement('div'),article=a.document.createElement('article'),p=a.document.createElement('p');article.dataset.node='n';article.append(p);scroll.append(article);scroll.scrollTop=200;
  scroll.getBoundingClientRect=()=>({top:0,bottom:500});let y=20;p.getBoundingClientRect=()=>({top:y,bottom:y+30,height:30});
  const anchor=N.capture(scroll);y=180;N.restore(scroll,anchor);assert.equal(scroll.scrollTop,360);
  // Every handle method must be called synchronously before capture returns.
  let captured=0;const modern={kind:'directory',name:'folder',async *values(){yield {kind:'file',name:'conversations.json',getFile:async()=>new Blob(['[]'])}}};
  const transfer=T.capture({items:[{kind:'file',getAsFileSystemHandle(){captured++;return Promise.resolve(modern)}}],files:[]});assert.equal(captured,1);assert.equal((await T.read(transfer))[0].path,'conversations.json');
  console.log('Offline DOM checks passed: math, writing wrapper, title/body highlight, cross-branch cyclic navigation, text-span matches, anchor restoration, synchronous drag capture.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={setup};
