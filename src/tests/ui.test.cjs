const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{setup}=require('./dom_checks.cjs'),C=require('../viewer_core.js'),Zip=require('../vendor/jszip/jszip.min.js'),IO=require('../viewer_storage.js')(C,Zip),{memoryFS}=require('./memory_fs.cjs');
const raw=JSON.stringify([{id:'a',title:'original',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['Question\n\n```js\nconst value=1;\n```']}}}}}]);
async function load(a){await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])}]);return a.api.state.records[0]}
const event=(d,type,props={})=>Object.assign(new d.defaultView.Event(type,{bubbles:true,cancelable:true}),props);
test('external folder data can be dropped anywhere, while internal image drag remains ignored',async()=>{
 const a=setup({editing:true}),d=a.document;await load(a);const image=d.createElement('img');d.getElementById('msgs').append(image);const drag=event(d,'dragstart');image.dispatchEvent(drag);assert.equal(drag.defaultPrevented,true);
 const file=new Blob([raw.replace('original','dropped')]);Object.defineProperty(file,'name',{value:'conversations.json'});
 const transfer={types:['Files'],files:[file],items:[]};d.body.dispatchEvent(event(d,'dragenter',{dataTransfer:transfer}));assert.equal(d.body.classList.contains('external-drop'),true);
 d.getElementById('msgs').dispatchEvent(event(d,'drop',{dataTransfer:transfer}));
 for(let i=0;i<200&&a.api.state.records[0]?.raw.title!=='dropped';i++)await new Promise(r=>setTimeout(r,5));assert.equal(a.api.state.records[0].raw.title,'dropped');assert.equal(d.body.classList.contains('external-drop'),false);
});
test('save icon keeps ordinary styling through edits, undo and backup setting changes',async()=>{
 const a=setup({editing:true}),r=await load(a),b=a.document.getElementById('save-workspace'),initial=b.className;
 assert.equal(b.classList.contains('saved-highlight'),false);
 a.api.commit([{doc:r.doc,path:[0,'title'],value:'changed'}]);assert.equal(b.className,initial);a.api.historyEdit('undo');assert.equal(b.className,initial);
 a.document.getElementById('backup-toggle').click();await a.api.state.backupTask;assert.equal(b.className,initial);assert.equal(a.api.journal.dirty,true);
 const css=fs.readFileSync(path.join(__dirname,'../viewer_styles.css'),'utf8');assert.equal(css.includes('saved-highlight'),false);
});
test('ZIP saving emits compression progress, indeterminate writing, and completion after write',async()=>{
 const original=await IO.zipBlob(null,[{path:'conversations.json',blob:new Blob([raw])}]),target=memoryFS({'a.zip':new Uint8Array(await original.arrayBuffer())}),opened=await IO.zip(original,target.file('a.zip')),events=[];
 const next=[{path:'conversations.json',blob:new Blob([raw.replace('original','saved')])}];await IO.saveZip(opened.source,next,opened.source.handle,false,(stage,percent)=>events.push([stage,percent]));
 assert.ok(events.some(([stage,p])=>stage==='压缩 ZIP'&&p>=0&&p<=100));assert.ok(events.some(([stage,p])=>stage==='写入 ZIP'&&p===null));assert.deepEqual(events.at(-1),['保存完成',100]);assert.ok((await IO.zip(target.files.get('a.zip'))).entries.length);
});
test('code controls are outside horizontally scrolling pre and scoped sticky styling preserves expected print implementation',async()=>{
 const a=setup({editing:true});await load(a);const d=a.document,pre=d.querySelector('#msgs pre'),box=pre.parentElement;assert.equal(box.className,'code-block');assert.ok(box.querySelector('.code-tools .copy-code'));assert.equal(pre.querySelector('button'),null);
 const css=fs.readFileSync(path.join(__dirname,'../viewer_styles.css'),'utf8');assert.ok(css.includes('.chat-container .message-header{position:sticky'));assert.ok(css.includes('.chat-container .code-tools{position:sticky'));assert.ok(css.includes('select:focus,select:focus-visible{outline:none;box-shadow:none}'));
 assert.equal(require('crypto').createHash('sha256').update(Buffer.from(fs.readFileSync(path.join(__dirname,'../viewer_print.js'),'utf8').replace('markdown(block.text,message)','markdown(block.text)').replace(/\r\n/g,'\n'))).digest('hex'),'de955e30d22d736ec0f1760f2617c18e81e1cbb07b5944e4e118db57ab8d8547');
});
test('all supported locales have explicit extended interface translations; code buttons translate without changing content',async()=>{
 const a=setup({editing:true});await load(a);const I=a.ctx.ViewerI18n;
 for(const locale of I.locales){I.setLanguage(locale);assert.equal(I.translationGaps(locale).length,0,locale)}
 I.setLanguage('ja');assert.equal(I.t('导出为文件夹'),'フォルダーにエクスポート');a.document.getElementById('language').value='ja';a.document.getElementById('language').dispatchEvent(event(a.document,'change'));
 assert.equal(a.document.querySelector('.copy-code').textContent,'コードをコピー');assert.ok(a.document.getElementById('msgs').textContent.includes('const value=1;'));
 assert.equal(I.t('准备导出 2 段聊天，包含当前未保存的编辑内容。'),'2 件の会話を出力（未保存の変更を含む）。');
});
test('multi-select reserves both translated labels and hides inactive count without removing reserved space',async()=>{
 const a=setup({editing:true});await load(a);const b=a.document.getElementById('multi-toggle');assert.equal(b.dataset.enterLabel,'多选');assert.equal(b.dataset.exitLabel,'退出多选');b.click();assert.equal(b.dataset.exitLabel,'退出多选');b.click();assert.equal(a.document.getElementById('selection-count').hidden,true);
 const css=fs.readFileSync(path.join(__dirname,'../viewer_styles.css'),'utf8');assert.ok(css.includes('content:attr(data-enter-label)'));assert.ok(css.includes('content:attr(data-exit-label)'));assert.ok(css.includes('#selection-count[hidden]{display:block!important;visibility:hidden}'));
});
test('status messages created in one language switch immediately through other languages without touching user text',async()=>{
 const a=setup({editing:true}),I=a.ctx.ViewerI18n;I.setLanguage('en');await load(a);assert.ok(a.document.getElementById('status').textContent.includes('Loaded'));
 I.setLanguage('ja');assert.equal(a.document.getElementById('status').textContent,'1 件の会話を読み込みました');
 I.setLanguage('fr');assert.ok(a.document.getElementById('status').textContent.includes('chargées'));
 I.setLanguage('zh-CN');assert.equal(a.document.getElementById('status').textContent,'已加载 1 个会话；默认显示当前分支');assert.equal(a.api.state.records[0].raw.title,'original');
});
