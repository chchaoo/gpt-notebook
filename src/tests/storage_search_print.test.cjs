const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../viewer_core.js'),Z=require('../vendor/jszip/jszip.min.js'),S=require('../viewer_storage.js')(C,Z),Search=require('../viewer_search.js'),Print=require('../viewer_print.js')(C,require('../viewer_exports.js'));
const {memoryFS}=require('./memory_fs.cjs'),{setup}=require('./dom_checks.cjs');
const entries=value=>Object.entries(value).map(([path,text])=>({path,blob:new Blob([text])}));

test('in-place directory save skips unchanged assets without persistent old-file backups',async()=>{
 const fs=memoryFS({'conversations.json':'old','media/x.dat':'binary'}),opened=await S.directory(fs.root);
 const result=await S.saveDirectory(opened.source,entries({'conversations.json':'new','media/x.dat':'binary','.viewer-state/viewer-settings.json':'{}'}));
 assert.equal(await fs.files.get('conversations.json').text(),'new');assert.equal(result.written,2);
 assert.deepEqual([...fs.files.keys()].sort(),['.viewer-state/viewer-settings.json','conversations.json','media/x.dat']);assert.equal(fs.calls.some(([_,p])=>p==='media/x.dat'),false);
 assert.equal((await S.directory(fs.root)).entries.length,3);assert.equal((await S.saveDirectory(result.source,entries({'conversations.json':'new','media/x.dat':'binary','.viewer-state/viewer-settings.json':'{}'}))).written,0);
});
test('external changes and denied permissions never overwrite source files',async()=>{
 const fs=memoryFS({'conversations.json':'old'}),opened=await S.directory(fs.root);fs.files.set('conversations.json',new Blob(['external']));
 await assert.rejects(S.saveDirectory(opened.source,entries({'conversations.json':'draft'})),/其他程序/);assert.equal(await fs.files.get('conversations.json').text(),'external');
 fs.control.denied=true;await assert.rejects(S.saveDirectory(opened.source,entries({'conversations.json':'draft'})),/权限/);
});
test('failed commit rolls back earlier writes without persistent backup copies',async()=>{
 const fs=memoryFS({'a.json':'old A','b.json':'old B'}),opened=await S.directory(fs.root);let once=true;
 fs.control.fail=(phase,path)=>phase==='close'&&path==='b.json'&&once?(once=false,new Error('disk full')):null;
 await assert.rejects(S.saveDirectory(opened.source,entries({'a.json':'new A','b.json':'new B'})),/已回滚/);
 assert.equal(await fs.files.get('a.json').text(),'old A');assert.equal(await fs.files.get('b.json').text(),'old B');
 assert.deepEqual([...fs.files.keys()].sort(),['a.json','b.json']);
});
test('failed opening a newly created writer removes the empty target',async()=>{
 const fs=memoryFS({}),opened=await S.directory(fs.root);fs.control.fail=(phase,path)=>phase==='open'&&path==='new.json'?new Error('write denied'):null;
 await assert.rejects(S.saveDirectory(opened.source,entries({'new.json':'draft'})),/已回滚/);assert.equal(fs.files.has('new.json'),false);
});
test('ZIP supports compressed archives, root prefix, exact untouched media and repeated in-place save',async()=>{
 const zip=new Z();zip.file('export/conversations.json','[1]');zip.file('export/media/图片.png',Uint8Array.from([0,255,20]));
 const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),fs=memoryFS({'source.zip':bytes}),opened=await S.zip(await fs.file('source.zip').getFile(),fs.file('source.zip'));
 assert.equal(opened.source.prefix,'export/');assert.equal(opened.entries.length,2);
 const edited=opened.entries.map(e=>e.path==='conversations.json'?{...e,blob:new Blob(['[2]'])}:e);
 const saved=await S.saveZip(opened.source,edited);const reread=await S.zip(await fs.file('source.zip').getFile());
 assert.equal(await reread.entries.find(e=>e.path==='conversations.json').blob.text(),'[2]');assert.deepEqual(new Uint8Array(await reread.entries.find(e=>e.path.startsWith('media/')).blob.arrayBuffer()),Uint8Array.from([0,255,20]));
 await S.saveZip(saved,edited);fs.files.set('source.zip',new Blob(['external']));await assert.rejects(S.saveZip(saved,edited),/其他程序/);
});
test('Save As ZIP from a directory can subsequently be saved as ZIP',async()=>{
 const fs=memoryFS({'a.zip':''}),source=await S.readonly(entries({'conversations.json':'[1]'}));
 const next=await S.saveZip(source,entries({'conversations.json':'[2]'}),fs.file('a.zip'),true);await S.saveZip(next,entries({'conversations.json':'[3]'}));
 assert.equal(await (await S.zip(await fs.file('a.zip').getFile())).entries[0].blob.text(),'[3]');
});
test('malicious ZIP names are rejected before normalization or extraction',async()=>{
 for(const name of ['../escape.txt','A.json']){const z=new Z();z.file(name,'x');if(name==='A.json')z.file('a.json','y');const blob=new Blob([await z.generateAsync({type:'uint8array'})]);await assert.rejects(S.zip(blob),/路径/)}
 await assert.rejects(S.zip(new Blob(['broken'])),/ZIP/);
});
test('search supports case, wildcards, whole words, accents and safe regex',()=>{
 assert.equal(Search.ranges('Hello hello','hello').length,2);assert.equal(Search.ranges('Hello hello','hello',{caseSensitive:true}).length,1);
 assert.equal(Search.ranges('cat cats cat','cat',{wholeWord:true}).length,2);
 assert.equal(Search.ranges('café','cafe',{diacritics:true})[0].end,4);
 assert.equal(Search.ranges('abc axc','a?c',{mode:'wildcard'}).length,2);
 assert.equal(Search.ranges('A12 B34','[A-Z]\\d+',{mode:'regex'}).length,2);
 assert.throws(()=>Search.compile('[',{mode:'regex'}));assert.throws(()=>Search.compile('(?=x)',{mode:'regex'}));
 const t=Date.now();assert.equal(Search.test('a'.repeat(50000)+'!','(a+)+$',{mode:'regex'}),false);assert.ok(Date.now()-t<3000);
});
test('print validates sizes, preserves drafts and full content beyond the preview batch',async()=>{
 assert.deepEqual(Print.settings({paper:'A4',orientation:'landscape'}).width,297);assert.throws(()=>Print.settings({paper:'custom',width:50,height:50,margin:40}));
 const a=setup({editing:true}),mapping={};for(let i=0;i<55;i++)mapping['n'+i]={parent:i?'n'+(i-1):null,message:{author:{role:'assistant'},content:{content_type:'text',parts:['message '+i]}}};
 await a.api.loadEntries(entries({'conversations.json':JSON.stringify([{title:'test',current_node:'n54',mapping}])}));const r=a.api.state.records[0];
 a.api.commit([{doc:r.doc,path:[0,'mapping','n54','message','content','parts',0],value:'UNSAVED LAST MESSAGE'}]);
 let prints=0;a.ctx.print=()=>prints++;a.document.getElementById('print-scope').value='all';await a.api.startPrint();
 assert.equal(prints,1);assert.equal(a.document.querySelectorAll('#print-document .print-message').length,55);assert.ok(a.document.getElementById('print-document').textContent.includes('UNSAVED LAST MESSAGE'));assert.equal(a.api.unsaved(),true);
});
test('selection actions stay fixed, select all visible items and clear selection',async()=>{
 const a=setup({editing:true});await a.api.loadEntries(entries({'conversations.json':'[{"title":"A","mapping":{}},{"title":"B","mapping":{}}]'}));
 const d=a.document;assert.equal(d.getElementById('selection-tools').hidden,false);d.getElementById('search').value='A';await a.api.renderList();
 d.getElementById('select-visible').click();assert.equal(a.api.state.selected.size,1);assert.equal(a.api.state.multi,true);d.getElementById('select-none').click();assert.equal(a.api.state.selected.size,0);assert.equal(d.getElementById('selection-delete').disabled,true);
 assert.ok(d.getElementById('selection-count').parentElement.classList.contains('list-management'));assert.ok(d.getElementById('selection-tools').parentElement.classList.contains('sidebar-summary'));
});
test('language changes UI only and side pane width is clamped',async()=>{
 const a=setup({editing:true});await a.api.loadEntries(entries({'conversations.json':'[{"title":"文件","mapping":{}}]'}));a.ctx.ViewerI18n.setLanguage('en');
 assert.equal(a.document.querySelector('.conv-title').textContent,'文件');assert.equal(a.document.querySelector('.menu-bar summary').textContent,'File');
 assert.equal(a.api.applySidebarWidth(5),260);assert.equal(a.api.applySidebarWidth(9999),640);
});
test('saved edit undone to original is still unsaved and regenerates chat HTML',async()=>{
 const a=setup({editing:true}),raw='[{"title":"original","mapping":{}}]',fs=memoryFS({'conversations.json':raw,'chat.html':'<script>var jsonData='+raw+';var assetsJson={};</script>'});
 const opened=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(opened.entries,null,opened.source);const r=a.api.state.records[0];
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'saved change'}]);await a.api.saveWorkspace();assert.equal(a.api.unsaved(),false);
 a.api.historyEdit('undo');assert.equal(a.api.unsaved(),true);await a.api.saveWorkspace();assert.equal(a.api.unsaved(),false);
 assert.equal(JSON.parse(await fs.files.get('conversations.json').text())[0].title,'original');assert.ok((await fs.files.get('chat.html').text()).includes('original'));assert.ok(!(await fs.files.get('chat.html').text()).includes('saved change'));
});
test('title index groups Chinese pinyin, polyphones, Latin and symbols consistently',async()=>{
 const T=require('../viewer_title_index.js');assert.equal(T.info('重庆旅行').group,'C');assert.equal(T.info('信号处理').group,'X');assert.equal(T.info('École').group,'E');assert.equal(T.info('123').group,'#');
 const a=setup({editing:true}),rows=[...Array.from({length:205},(_,i)=>({title:'阿 '+i,mapping:{}})),{title:'信号处理',mapping:{}}];
 await a.api.loadEntries(entries({'conversations.json':JSON.stringify(rows)}));a.api.state.sort='title';await a.api.renderList();
 const rail=a.document.getElementById('alphabet-index');assert.equal(rail.hidden,false);assert.equal(rail.querySelectorAll('button').length,27);
 const x=[...rail.querySelectorAll('button')].find(b=>b.textContent==='X');x.click();for(let i=0;i<60&&!a.document.querySelector('[data-letter="X"][data-scrolled="1"]');i++)await new Promise(r=>setTimeout(r,5));
 assert.ok([...a.document.querySelectorAll('[data-letter]')].some(e=>e.dataset.letter==='X'&&e.dataset.scrolled==='1'));
 a.api.state.sort='updated';await a.api.renderList();assert.equal(rail.hidden,true);
});
test('menus close each other and outside clicks close the open menu',()=>{
 const a=setup({editing:true}),menus=[...a.document.querySelectorAll('.exclusive-menu')],first=menus[2],second=menus[3];first.open=true;
 second.querySelector('summary').click();assert.equal(first.open,false);second.open=true;a.document.body.click();assert.equal(second.open,false);
});
test('internal image drags are ignored; external preview drop is limited to the marked target',async()=>{
 const a=setup({editing:true}),d=a.document;await a.api.loadEntries(entries({'conversations.json':'[{"title":"original","mapping":{}}]'}));
 const image=d.createElement('img');d.getElementById('msgs').append(image);const start=new d.defaultView.Event('dragstart',{bubbles:true,cancelable:true});image.dispatchEvent(start);assert.equal(start.defaultPrevented,true);
 const enter=new d.defaultView.Event('dragenter',{bubbles:true,cancelable:true});enter.dataTransfer={types:['Files']};d.body.dispatchEvent(enter);assert.ok(d.body.classList.contains('external-drop'));
 const drop=new d.defaultView.Event('drop',{bubbles:true,cancelable:true});drop.dataTransfer={types:['Files'],files:[new Blob(['bad'])],items:[]};d.getElementById('msgs').dispatchEvent(drop);
 await new Promise(r=>setTimeout(r,5));assert.equal(a.api.state.records[0].raw.title,'original');assert.equal(d.body.classList.contains('external-drop'),false);
});
