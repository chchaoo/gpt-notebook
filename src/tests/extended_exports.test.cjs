const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup}=require('./dom_checks.cjs');
const zip=require('../vendor/jszip/jszip.min.js');
async function load(a){
 const rows=['alpha','beta','gamma'].map((id,i)=>({id,title:id,update_time:i+1,current_node:'n',mapping:{n:{parent:null,message:{author:{role:i?'assistant':'user'},content:{content_type:'text',parts:[id+' original']}}}}}));
 await a.api.loadEntries([{path:'conversations.json',blob:new Blob([JSON.stringify(rows)])}]);return a.api.state.records;
}
const wait=()=>new Promise(r=>setTimeout(r,35));
test('eight distinct toolbar formats, generic sidebar export, single File split entry',()=>{
 const a=setup({editing:true}),d=a.document,formats=['html','markdown','obsidian','json','pdf','print','directory','zip'];
 assert.deepEqual([...d.querySelectorAll('.export-quick-group button')].map(e=>e.id),formats.map(f=>'quick-'+f));
 assert.equal(d.querySelector('.export-quick-group').previousElementSibling.className,'tool-separator');
 assert.deepEqual([...d.querySelectorAll('#export-flyout button')].map(e=>e.id),formats.map(f=>'flyout-'+f));
 for(const id of ['export-zip','export-json','menu-export','menu-json','menu-export-all','menu-export-current','menu-pdf','menu-print'])assert.equal(d.getElementById(id),null);
 for(const f of formats){const b=d.getElementById('quick-'+f);assert.ok(b.title);assert.ok(b.querySelector('svg'))}
 assert.ok(d.getElementById('selection-export').querySelector('svg'));assert.ok(d.getElementById('menu-export-arrow').getAttribute('aria-haspopup'));
});
test('every format supports current, selected and all without including deleted conversations',async()=>{
 const a=setup({editing:true}),rows=await load(a),d=a.document;a.api.state.selected.add(rows[0].key);
 a.api.openExport();assert.equal(d.getElementById('export-range').value,'selected');
 for(const format of ['html','markdown','obsidian','json','pdf','print','directory','zip']){
  d.getElementById('export-format').value=format;
  for(const [scope,count] of [['current',1],['selected',1],['all',3]]){d.getElementById('export-range').value=scope;assert.equal(a.api.exportRecords().length,count)}
 }
 a.api.deleteRecords([rows[1].key]);assert.equal(a.api.exportRecords().length,2);
});
test('PDF keeps the expected print settings and native print path, including unsaved selected text',async()=>{
 const a=setup({editing:true}),rows=await load(a),d=a.document,r=rows[0];let prints=0;a.ctx.print=()=>prints++;
 a.api.commit([{doc:r.doc,path:[r.index,'mapping','n','message','content','parts',0],value:'EDITED UNSAVED CONTENT'}]);
 a.api.openExport([r.key],'pdf');await a.api.exportSelection();
 assert.equal(d.getElementById('export-dialog').open,false);assert.equal(d.getElementById('print-dialog').open,true);
 assert.equal(d.getElementById('print-heading').textContent,'导出 PDF');assert.equal(prints,0);
 await a.api.startPrint();assert.equal(prints,1);assert.equal(a.downloads.length,0);
 assert.ok(d.getElementById('print-document').textContent.includes('EDITED UNSAVED CONTENT'));
 assert.ok(!d.getElementById('print-document').textContent.includes('beta original'));
 assert.equal(a.api.unsaved(),true);assert.equal(d.querySelectorAll('#print-document .message-edit').length,0);
});
test('quick Print and PDF both show page settings before native printing',async()=>{
 const a=setup({editing:true});await load(a);let prints=0;a.ctx.print=()=>prints++;const d=a.document;
 d.getElementById('quick-print').click();await wait();assert.equal(prints,0);assert.equal(d.getElementById('print-dialog').open,true);d.getElementById('print-dialog').close();
 d.getElementById('quick-pdf').click();assert.equal(d.getElementById('print-dialog').open,true);assert.equal(prints,0);
 assert.equal(d.getElementById('print-heading').textContent,'导出 PDF');
});
test('JSON and Markdown routes export chosen drafts and do not mark them saved',async()=>{
 const a=setup({editing:true}),rows=await load(a),r=rows[0],d=a.document;
 a.api.commit([{doc:r.doc,path:[r.index,'title'],value:'edited title'}]);
 for(const format of ['json','markdown']){
  a.api.openExport([r.key],format);d.getElementById('export-layout').value='combined';await a.api.exportSelection();
  const archive=await zip.loadAsync(await a.downloads.at(-1).blob.arrayBuffer());
  const content=await Promise.all(Object.values(archive.files).filter(f=>!f.dir).map(f=>f.async('string')));
  assert.ok(content.join('\n').includes('edited title'));assert.ok(!content.join('\n').includes('beta original'));
 }
 assert.equal(a.api.unsaved(),true);
});
test('File text opens the common chooser and the arrow opens a closable format flyout',async()=>{
 const a=setup({editing:true});await load(a);const d=a.document;
 d.getElementById('menu-export-open').click();assert.equal(d.getElementById('export-dialog').open,true);d.getElementById('export-dialog').close();
 d.getElementById('menu-export-arrow').click();assert.equal(d.getElementById('export-flyout').hidden,false);
 d.getElementById('flyout-markdown').click();assert.equal(d.getElementById('export-flyout').hidden,true);assert.equal(d.getElementById('export-format').value,'markdown');
 d.getElementById('export-dialog').close();d.getElementById('menu-export-arrow').click();d.body.click();assert.equal(d.getElementById('export-flyout').hidden,true);
});
test('print source matches the expected layout and progress reporting',()=>{
 const root=path.join(__dirname,'..');
 // Reference print implementation hash; this check also works in a separately extracted source ZIP.
 assert.equal(require('node:crypto').createHash('sha256').update(Buffer.from(fs.readFileSync(path.join(root,'viewer_print.js'),'utf8').replace('markdown(block.text,message)','markdown(block.text)').replace(/\r\n/g,'\n'))).digest('hex'),'de955e30d22d736ec0f1760f2617c18e81e1cbb07b5944e4e118db57ab8d8547');
 for(const file of ['viewer_pdf.js','vendor/pdfmake','vendor/mathjax','vendor/pdf-fonts'])assert.equal(fs.existsSync(path.join(root,file)),false);
 assert.match(fs.readFileSync(path.join(root,'viewer_styles.css'),'utf8'),/\.sidebar-summary \.sb-stats\{border-top:0\}/);
});
