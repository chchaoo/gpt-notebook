const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let at=__dirname,DOM;try{DOM=require('linkedom')}catch(_){}while(!DOM&&at!==path.dirname(at)){const p=path.join(at,'测试依赖/node_modules/linkedom');if(fs.existsSync(p)){DOM=require(p);break}at=path.dirname(at)}
const E=require('../viewer_exports.js'),C=require('../viewer_core.js');
async function main(){
 const product=fs.readFileSync(path.join(__dirname,'../gpt-notebook.html'),'utf8');
 const raw='[{"id":"boot","title":"便携导出启动验收","current_node":"a","mapping":{"a":{"parent":null,"message":{"author":{"role":"assistant"},"content":{"content_type":"text","parts":["\\\\[ x^2 \\\\]"]}}}}}]';
 const doc=C.document(raw),payload=await E.payload([{raw:doc.data[0],doc,index:0,id:'boot',key:'0'}],new Map());
 const bundle=process.argv.includes('--bundle')?await E.bundle([{raw:doc.data[0],doc,index:0,id:'boot',key:'0'}],new Map(),product):null;
 const html=bundle?await bundle.find(e=>e.path==='chat.html').blob.text():E.html(product,payload),{document,window}=DOM.parseHTML(html);
 Object.defineProperty(document,'compatMode',{value:'CSS1Compat'});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const o of this.querySelectorAll('option'))o.value===value?o.setAttribute('selected',''):o.removeAttribute('selected')}});
 const context={document,Node:window.Node,HTMLElement:window.HTMLElement,Element:window.Element,MutationObserver:window.MutationObserver,Blob,TextEncoder,TextDecoder,URL,console,setTimeout,clearTimeout,
  navigator:{language:'zh-CN',userAgent:'Mozilla/5.0 OfflineDOM',vendor:'',platform:'Win32'},location:{hash:'',href:'https://offline.invalid/'},history:{pushState(){}},
  addEventListener(){},removeEventListener(){},innerWidth:1280,innerHeight:800,confirm:()=>true,atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false,addEventListener(){}})};
 context.window=context.self=context;vm.createContext(context);
 for(const tag of document.querySelectorAll('script[nonce]')){
  let code=tag.textContent;if(code.includes('updateChanges(); loadBaked();'))code=code.replace('updateChanges(); loadBaked();','globalThis.bootState=state;globalThis.bootJournal=journal;globalThis.bootOutline=turnOutline;globalThis.bootJump=jumpToTurn;updateChanges();loadBaked();');
  vm.runInContext(code,context,{timeout:10000});
 }
 for(let i=0;i<100&&document.getElementById('loader').hidden!==true;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(context.bootState.records[0]?.raw.title,'便携导出启动验收');
 assert.equal(typeof context.toastui.Editor,'function');assert.equal(document.getElementById('loader').hidden,true);
 assert.equal(context.ViewerSanitizerVersion,'3.4.17');
 console.log('Generated single-file HTML and selected portable HTML booted with all actual bundled scripts in offline DOM.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
