const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../viewer_core.js'),E=require('../viewer_exports.js'),{setup}=require('./dom_checks.cjs'),Zip=require('../vendor/jszip/jszip.min.js');
const image='data:image/png;base64,iVBORw0KGgo=';
function records(titles){const doc=C.document(JSON.stringify(titles.map((title,i)=>({id:'item-'+i,title,current_node:'n',mapping:{n:{parent:null,message:{author:{role:'assistant'},content:{content_type:'text',parts:['![local]('+image+')']}}}}}))));doc.path='conversations.json';return doc.data.map((raw,index)=>({raw,index,doc,key:String(index),id:raw.id}))}
async function checkLinks(entries){const paths=new Set(entries.map(e=>e.path));assert.equal(paths.size,entries.length);for(const entry of entries.filter(e=>e.path.endsWith('.md'))){const text=await entry.blob.text();for(const line of text.split('\n').filter(l=>l.startsWith('![插入图片]('))){const target=decodeURIComponent(line.slice('![插入图片]('.length,-1));assert.ok(paths.has(target),'Missing target '+target)}}}
test('separate Markdown shares exactly one full basename with its media directory, including duplicate and long titles',async()=>{
 const rows=records(['同名','同名','相同前缀'.repeat(12)+'甲','相同前缀'.repeat(12)+'乙','CON','a# (test)']);
 const entries=await E.markdown(rows,new Map(),{combined:false});await checkLinks(entries);
 const names=entries.filter(e=>e.path.endsWith('.md')).map(e=>e.path.slice(0,-3));
 assert.equal(names[1],'同名 (2)');assert.notEqual(names[2],names[3]);
 for(const name of names){assert.ok(entries.some(e=>e.path.startsWith('media/'+name+'/')),name)}
 assert.ok(!entries.some(e=>/^media\/\d+-/.test(e.path)));
});
test('nonduplicate media paths remain unchanged when records reorder or unrelated records are omitted',async()=>{
 const rows=records(['无关记录','完成作业解答','页内偏移量纠错']);
 const paths=async list=>(await E.markdown(list,new Map(),{combined:false})).filter(e=>e.path.startsWith('media/')).map(e=>e.path).sort();
 assert.deepEqual(await paths(rows),await paths([...rows].reverse()));
 const single=await paths([rows[1]]);assert.ok(single.every(p=>p.startsWith('media/完成作业解答/')));
 assert.ok((await paths(rows)).includes(single[0]));
});
test('combined Markdown retains resolving media links without numeric directory prefixes',async()=>{
 const entries=await E.markdown(records(['同名','同名']),new Map(),{combined:true,name:'合并资料'});await checkLinks(entries);
 assert.equal(entries.filter(e=>e.path.endsWith('.md')).length,1);assert.equal(entries[0].path,'合并资料.md');
 assert.ok(entries.some(e=>e.path.startsWith('media/同名 (2)/')));
});
test('same-named source attachments remain distinct with exact bytes under the matching title',async()=>{
 const rows=records(['附件测试']),resources=new Map();
 for(const [i,id] of ['file_12345678','file_87654321'].entries()){
  rows[0].raw.mapping.n.message.content.parts.push({content_type:'image_asset_pointer',asset_pointer:'sediment://'+id});
  resources.set(id,{path:id+'.png',name:'same.png',blob:new Blob(['bytes-'+i],{type:'image/png'})});
 }
 const entries=await E.markdown(rows,resources,{combined:false});
 for(const [file,bytes] of [['same.png','bytes-0'],['same (2).png','bytes-1']]){const entry=entries.find(e=>e.path==='media/附件测试/'+file);assert.ok(entry);assert.equal(await entry.blob.text(),bytes);assert.ok((await entries[0].blob.text()).includes(encodeURIComponent(file)))}
});
test('title filename cleanup remains Windows-safe after truncation in all export formats',()=>{
 assert.equal(E.filename('a'.repeat(79)+'.rest'),'a'.repeat(79));
 assert.equal(E.filename('a'.repeat(79)+' rest'),'a'.repeat(79));
 assert.equal(E.filename('CON'),'_CON');assert.equal(E.filename('abc. '),'abc');
 const entries=records(['e\u0301','é']);const used=new Set();assert.notEqual(E.unique(E.filename(entries[0].raw.title),used),E.unique(E.filename(entries[1].raw.title),used));
});
test('HTML and JSON separate exports already use title names and deduplicate, without ordinal prefixes',async()=>{
 const a=setup({editing:true}),rows=records(['同名','同名','不同标题']);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([C.serialize(rows[0].doc)])}]);
 for(const format of ['html','json']){
  a.api.openExport(a.api.state.records.map(r=>r.key),format);a.document.getElementById('export-layout').value='separate';await a.api.exportSelection();
  const archive=await Zip.loadAsync(await a.downloads.at(-1).blob.arrayBuffer()),files=Object.keys(archive.files).filter(p=>!archive.files[p].dir);
  const targets=format==='html'?files:files.filter(p=>p.endsWith('/conversations.json'));
  assert.equal(targets.length,3);assert.ok(targets.some(p=>p.startsWith('同名 (2)')));assert.ok(targets.every(p=>!/^[0-9]+-/.test(p)));
 }
});
test('toolbar, File flyout and generic Print all wait for page settings confirmation',async()=>{
 const a=setup({editing:true}),d=a.document,rows=records(['one','two']);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([C.serialize(rows[0].doc)])}]);let prints=0;a.ctx.print=()=>prints++;
 for(const id of ['quick-print','flyout-print']){d.getElementById(id).click();assert.equal(d.getElementById('print-dialog').open,true);assert.equal(prints,0);assert.equal(d.getElementById('print-heading').textContent,'打印');d.getElementById('print-dialog').close()}
 a.api.openExport(undefined,'print');d.getElementById('export-range').value='all';await a.api.exportSelection();assert.equal(d.getElementById('print-dialog').open,true);assert.equal(d.getElementById('print-scope').value,'all');assert.equal(prints,0);
 d.getElementById('print-paper').value='Letter';d.getElementById('print-orientation').value='landscape';await a.api.startPrint();assert.equal(prints,1);assert.ok(d.getElementById('print-page-style').textContent.includes('279.4mm 215.9mm'));
 assert.ok(d.getElementById('print-document').textContent.includes('one'));assert.ok(d.getElementById('print-document').textContent.includes('two'));
});
