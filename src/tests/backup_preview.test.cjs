const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs'),{memoryFS}=require('./memory_fs.cjs');
const bodyPath=['mapping','q','message','content','parts',0];
const raw=JSON.stringify([{id:'one',title:'Old title',current_node:'q',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:['Old question\nsecond line']}}}}},{id:'two',title:'Second chat',mapping:{}}]);
async function open(a,fs){const x=await a.ctx.ViewerStorage.directory(fs.root);await a.api.loadEntries(x.entries,null,x.source);return a.api.state.records.find(r=>r.id==='one')}
function change(a,r,path,value){a.api.commit([{doc:r.doc,path:[r.index,...path],value}])}
async function seed(){const a=setup({editing:true}),fs=memoryFS({'conversations.json':raw}),r=await open(a,fs);change(a,r,['title'],'New title');await a.api.saveWorkspace();change(a,r,bodyPath,'Saved question\nnew second line');await a.api.saveWorkspace();return {a,fs,r,v:[...a.api.journal.data.records[r.historyUid].versions]}}
function row(a,id){return [...a.document.querySelectorAll('.backup-item')].find(e=>e.dataset.version===id)}
function expand(a,d){d.open=true;d.dispatchEvent(new a.document.defaultView.Event('toggle'));return d}

test('collapsed rows show concrete title/message snippets without reconstructing any snapshots',async()=>{
 const {a,r,v}=await seed();let inspections=0;const inspect=a.api.journal.inspect;a.api.journal.inspect=(...args)=>{inspections++;return inspect(...args)};
 await a.api.showBackups('edit',r.historyUid);assert.equal(inspections,0);assert.match(row(a,v[0].id).querySelector('.backup-excerpt').textContent,/Old.*→.*New/);assert.match(row(a,v[1].id).querySelector('.backup-excerpt').textContent,/用户 #1.*正文/);assert.ok(row(a,v[1].id).querySelector('.backup-excerpt').textContent.includes('→'));
 assert.equal(a.document.querySelectorAll('.backup-preview').length,0);expand(a,row(a,v[1].id).querySelector('.backup-details'));assert.equal(inspections,1);assert.equal(a.api.unsaved(),false);
});

test('expanded comparison uses saved content, not the live draft, and writes nothing',async()=>{
 const {a,fs,r,v}=await seed();change(a,r,bodyPath,'UNSAVED draft only');const files=new Map(fs.files),calls=fs.calls.length,data=JSON.stringify(a.api.journal.data),pending=a.api.journal.pendingCount;
 await a.api.showBackups('edit',r.historyUid);const details=expand(a,row(a,v[1].id).querySelector('.backup-details')),values=[...details.querySelectorAll('.backup-diff-columns pre')].map(e=>e.textContent);
 assert.deepEqual(values,['Old question\nsecond line','Saved question\nnew second line']);assert.equal(details.textContent.includes('UNSAVED'),false);assert.equal(a.api.journal.pendingCount,pending);assert.equal(JSON.stringify(a.api.journal.data),data);assert.equal(fs.calls.length,calls);for(const [p,b]of files)assert.equal(fs.files.get(p),b);assert.equal(a.api.unsaved(),true);
});

test('full historical content and raw data are lazy, literal and safe',async()=>{
 const {a,r,v}=await seed(),malicious='<img src="https://example.org/track" onerror="bad()"><script>bad()</script>';
 change(a,r,bodyPath,malicious);await a.api.saveWorkspace();change(a,r,bodyPath,'plain saved');await a.api.saveWorkspace();const id=a.api.journal.data.records[r.historyUid].versions.at(-1).id;
 await a.api.showBackups('edit',r.historyUid);const d=expand(a,row(a,id).querySelector('.backup-details'));assert.equal(d.querySelector('img,script,iframe'),null);assert.ok(d.textContent.includes(malicious));const full=d.querySelector('.backup-full');assert.equal(full.querySelector('pre'),null);expand(a,full);assert.ok(full.textContent.includes(malicious));assert.equal(full.querySelector('img,script,a'),null);
 const original=full.querySelector('.backup-original');assert.equal(original.querySelector('pre'),null);expand(a,original);assert.equal(original.querySelector('pre').textContent,a.api.journal.target(r.historyUid,id));assert.equal(a.api.unsaved(),false);
});

test('comparison follows retained neighbors after checkpoint deletion and still restores the previewed version',async()=>{
 const {a,r,v}=await seed();change(a,r,bodyPath,'Third saved question');await a.api.saveWorkspace();const last=a.api.journal.data.records[r.historyUid].versions.at(-1).id;
 assert.equal(await a.api.deleteBackup('edit',r.historyUid,v[1].id),true);const pair=a.api.journal.inspect(r.historyUid,v[0].id);assert.equal(JSON.parse(pair.before).title,'Old title');assert.equal(JSON.parse(pair.after).mapping.q.message.content.parts[0],'Saved question\nnew second line');
 await a.api.showBackups('edit',r.historyUid);const d=expand(a,row(a,last).querySelector('.backup-details'));assert.ok(d.textContent.includes('Saved question'));await a.api.restoreBackup('edit',r.historyUid,last);assert.equal(r.raw.mapping.q.message.content.parts[0],'Saved question\nnew second line');assert.equal(a.document.getElementById('backup-dialog').open,true);
});

test('deleted conversation previews represent absence and historical content without restoring it',async()=>{
 const {a,fs,r}=await seed(),uid=r.historyUid;a.api.deleteRecords([r.key]);await a.api.saveWorkspace();const before=new Map(fs.files);await a.api.showBackups('deleted');const d=expand(a,[...a.document.querySelectorAll('.backup-item')].find(e=>e.dataset.uid===uid).querySelector('.backup-details'));
 assert.ok(d.textContent.includes('Saved question'));assert.ok(d.textContent.includes('会话不存在'));assert.equal(a.api.orderedRecords().some(r=>r.historyUid===uid),false);for(const [p,b]of before)assert.equal(fs.files.get(p),b);assert.equal(a.api.unsaved(),false);
});

test('order previews compare saved orders even after an unsaved reorder',async()=>{
 const {a,r}=await seed(),other=a.api.state.records.find(r=>r.id==='two');a.api.moveRecord(other.key,r.key);await a.api.saveWorkspace();const version=a.api.journal.data.orders.at(-1).id,pair=a.api.journal.inspectOrder(version);a.api.moveRecord(r.key,other.key);await a.api.showBackups('order');
 const d=expand(a,row(a,version).querySelector('.backup-details')),orders=[...d.querySelectorAll('ol')].map(ol=>[...ol.querySelectorAll('li')].map(li=>li.textContent));assert.deepEqual(orders,[['New title','Second chat'],['Second chat','New title']]);assert.deepEqual(JSON.parse(JSON.stringify(a.api.journal.inspectOrder(version))),JSON.parse(JSON.stringify(pair)));assert.equal(a.api.unsaved(),true);
});

test('all eleven languages refresh open previews and keep historical user text untouched',async()=>{
 const {a,r,v}=await seed();change(a,r,bodyPath,'恢复');await a.api.saveWorkspace();change(a,r,bodyPath,'保存');await a.api.saveWorkspace();const id=a.api.journal.data.records[r.historyUid].versions.at(-1).id;
 await a.api.showBackups('edit',r.historyUid);expand(a,row(a,id).querySelector('.backup-details'));const keys=['查看详情','此历史版本','后续保存状态','完整历史内容','无法预览此版本','结构变化','项变更','会话不存在','不存在','原始数据','左侧为可恢复的历史内容，右侧为其后一次保留的保存状态。'];
 for(const locale of a.ctx.ViewerI18n.locales){const select=a.document.getElementById('language');select.value=locale;select.dispatchEvent(new a.document.defaultView.Event('change'));const d=row(a,id).querySelector('.backup-details');assert.equal(d.open,true);assert.equal(d.querySelector('summary').textContent,a.ctx.ViewerI18n.t('查看详情'));assert.deepEqual([...d.querySelectorAll('.backup-diff-columns pre')].map(e=>e.textContent),['恢复','保存']);if(!['zh-CN','zh-TW'].includes(locale))for(const key of keys)assert.notEqual(a.ctx.ViewerI18n.t(key),key,locale+': '+key)}
});

test('conflicting history reports unavailable preview without changing the draft',async()=>{
 const {a,r}=await seed();a.api.journal.data.records[r.historyUid].conflict=true;await a.api.showBackups('edit',r.historyUid);const d=expand(a,a.document.querySelector('.backup-details'));assert.ok(d.textContent.includes('无法预览此版本'));assert.equal(a.document.querySelector('.backup-item button').disabled,true);assert.equal(a.api.unsaved(),false);
});

test('long fields expose the changed area as well as the complete original values',async()=>{
 const {a,r}=await seed(),prefix='same long prefix '.repeat(1000),before=prefix+'OLD tail',after=prefix+'NEW tail';change(a,r,bodyPath,before);await a.api.saveWorkspace();change(a,r,bodyPath,after);await a.api.saveWorkspace();const id=a.api.journal.data.records[r.historyUid].versions.at(-1).id;
 await a.api.showBackups('edit',r.historyUid);const d=expand(a,row(a,id).querySelector('.backup-details')),focus=[...d.querySelectorAll('.backup-change-focus')].map(e=>e.textContent);assert.equal(focus.length,2);assert.ok(focus[0].includes('OLD tail'));assert.ok(focus[1].includes('NEW tail'));assert.ok(focus.every(s=>s.length<300));assert.deepEqual([...d.querySelectorAll('.backup-diff-columns pre')].map(e=>e.textContent),[before,after]);
});
