/* Browser UI. Raw sources are retained; viewing never writes to the chosen directory. */
(function () {
  'use strict';
  const C = ViewerCore, $ = id => document.getElementById(id);
  const N = ViewerNavigation;
  const E=ViewerExports, IO=ViewerStorage, Search=ViewerSearch, I=ViewerI18n, Print=ViewerPrint, TitleIndex=ViewerTitleIndex;
  const exportShell='<!doctype html>\n'+document.documentElement.outerHTML;
  let activeEditors=[];
  let turnOutline=null, audit=null;
  const journal=typeof ViewerJournal!=='undefined'?ViewerJournal.create():null;
  const historyStore=ViewerJournalStore.create();
  const editBlocked=()=>!state.editMode||state.modeChanging||state.busy&&!state.saving;
  const metadataPath=path=>path.startsWith('.viewer-state/')||path.startsWith('.viewer-backups/');
  const settingsPath='.viewer-state/viewer-settings.json';
  const modeHint='若要进行操作，请打开编辑模式';
  const enableControls=(el,blocked,label='')=>{
    el.disabled=blocked;
    I.setAttribute(el,'title',!state.editMode&&blocked?modeHint:label);
  };
  function updateEditControls(){
    const enabled=state.editMode&&!state.modeChanging,record=current();
    for(const id of ['edit-mode','menu-mode']){
      const el=$(id);el.setAttribute('aria-checked',String(enabled));el.disabled=!state.docs.length||state.busy||state.modeChanging||state.downloadPending;
    }
    $('menu-star').setAttribute('aria-checked',String(Boolean(record&&state.stars.has(record.key))));
    for(const id of ['menu-title','menu-star','edit-title'])enableControls($(id),editBlocked()||!record||(id!=='menu-star'&&typeof record.raw.title!=='string'),id==='menu-star'?'星标当前会话':'编辑当前标题');
    for(const id of ['menu-import','selection-import'])enableControls($(id),editBlocked()||state.busy||!state.docs.length,'增量导入');
    for(const direction of ['undo','redo']){
      const label=direction==='undo'?'撤销':'重做';
      for(const id of [direction,'menu-'+direction])enableControls($(id),!state[direction].length||editBlocked(),label);
      I.setAttribute($(direction+'-menu').querySelector('summary'),'title',!state.editMode?modeHint:(direction==='undo'?'选择撤销步数':'选择重做步数'));
    }
    for(const el of document.querySelectorAll('.message-edit'))enableControls(el,editBlocked(),'编辑');
    for(const el of document.querySelectorAll('.conversation-star'))enableControls(el,editBlocked(),el.getAttribute('aria-pressed')==='true'?'取消星标':'添加星标');
    for(const el of document.querySelectorAll('.conversation-delete'))enableControls(el,editBlocked(),'删除本条聊天');
    const manual=$('sort-order').querySelector('[value="manual"]');enableControls(manual,!state.editMode,'手动顺序');
  }
  const displaySort=()=>!state.editMode&&state.viewSort?state.viewSort:state.sort;
  let editorChanged=()=>false;
  const state = { docs: [], entries: new Map(), resources: new Map(), records: [], current: null,
    branches: new Map(), urls: new Set(), undo: [], redo: [], token: 0, loadToken: 0, busy: false, saving:false,
    opened: new Set(), limits: new Map(), queryToken: 0, cache: new Map(), notices: [], search:{query:'',hits:[],cursor:-1}, userScroll:0,savedSign:'',fileHandle:null,
    editMode:false,modeChanging:false,viewSort:null,stars:new Set(),addedEntries:new Map(),importDocs:new Set(),deleted:new Set(),selected:new Set(),multi:false,order:[],sort:'updated',orderModified:false,exportKeys:[],source:null,closeAfterSave:false };
  const text = (tag, value, cls) => { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; };
  const uiText=(tag,value,cls)=>{const el=text(tag,'',cls);I.setText(el,value);return el};
  const button = (label, action, cls) => { const el = text('button', I.t(label), cls);if(label)I.setText?.(el,label); el.type = 'button'; el.addEventListener('click', action); return el; };
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
  const blobText = async blob => new TextDecoder('utf-8', { ignoreBOM:true, fatal:true }).decode(await blob.arrayBuffer());
  const format = ts => { const d = new Date(C.timestamp(ts) * 1000); return ts && Number.isFinite(d.getTime()) ? d.toLocaleString(I.locale()) : ''; };
  function notify(message, error = false) {
    if(I.setText)I.setText($('status'),message);else $('status').textContent=I.t(message); $('status').classList.toggle('error', error);
    if(I.setText)I.setText($('loader-status'),message);else $('loader-status').textContent=I.t(message); $('loader-status').classList.toggle('error', error);
    const dialog=[...document.querySelectorAll('dialog')].filter(el=>el.open).at(-1);
    if(dialog){let notice=dialog.querySelector('.dialog-status');if(!notice){notice=text('p','','dialog-status');notice.setAttribute('role','status');dialog.append(notice)}if(I.setText)I.setText(notice,message);else notice.textContent=I.t(message);notice.classList.toggle('error',error)}
  }
  function revoke() { for (const url of state.urls) URL.revokeObjectURL(url); state.urls.clear(); }
  const readingStorageKey='viewer-reading-positions-v1';
  let readingPositions=null,displayedReading=null,readingTimer,removeReadingRestore=()=>{};
  function readingMap(){
    if(readingPositions)return readingPositions;readingPositions=new Map();
    try{const saved=JSON.parse(localStorage.getItem(readingStorageKey)||'[]');if(Array.isArray(saved))for(const pair of saved.slice(-500)){
      if(!Array.isArray(pair)||typeof pair[0]!=='string'||pair[0].length>4000)continue;const value=pair[1],a=value?.anchor;
      if(!a||!Number.isFinite(a.scrollTop)||a.scrollTop<0||!Number.isInteger(value.limit)||value.limit<0||value.limit>100000)continue;
      const anchor={scrollTop:a.scrollTop};if(typeof a.node==='string'&&a.node.length<=1000&&Number.isInteger(a.index)&&a.index>=-1&&Number.isFinite(a.offset))Object.assign(anchor,{node:a.node,index:a.index,offset:a.offset});
      readingPositions.set(pair[0],{anchor,limit:value.limit});
    }}catch(_){}return readingPositions;
  }
  function readingSource(){return [state.source?.kind?.startsWith('directory')?'directory':state.source?.kind||'',state.source?.name||'']}
  function readingKey(record,leaf){
    const duplicates=record.id&&state.records.filter(r=>r.doc===record.doc&&r.id===record.id).length>1;
    return JSON.stringify([...readingSource(),record.doc.path,record.id||record.index,duplicates?record.index:null,leaf||'']);
  }
  function lastReading(){
    const scope=readingSource(),records=activeRecords();
    for(const [key]of [...readingMap()].reverse())try{
      const parts=JSON.parse(key);if(!Array.isArray(parts)||parts.length!==6||parts[0]!==scope[0]||parts[1]!==scope[1])continue;
      const record=records.find(r=>r.doc.path===parts[2]&&(r.id||r.index)===parts[3]&&(parts[4]===null||r.index===parts[4]));
      if(record&&readingKey(record,parts[5])===key)return {record,leaf:parts[5]};
    }catch(_){}
    return null;
  }
  function rememberReading(){
    clearTimeout(readingTimer);if(!displayedReading)return;
    const container=$('chat-container'),anchor={...N.capture(container),scrollTop:Math.max(0,container.scrollTop||0)},map=readingMap();
    map.delete(displayedReading.key);map.set(displayedReading.key,{anchor,limit:Math.min(100000,Math.max(displayedReading.limit,state.limits.get(displayedReading.limitKey)||0))});
    while(map.size>500)map.delete(map.keys().next().value);
    try{localStorage.setItem(readingStorageKey,JSON.stringify([...map]))}catch(_){}
  }
  function reset() {
    rememberReading();displayedReading=null;removeReadingRestore();
    historyStore.reset();journal?.open([],[],null);state.journalProblem=null;state.structuralRevision=state.savedStructuralRevision=0;state.pendingJournal=null;state.downloadModeCheckpoint=null;state.backupTask=null;state.backupCleanupWarning=false;state.allowLegacyHistoryClear=false;
    state.historyFocusToken=(state.historyFocusToken||0)+1;
    turnOutline?.set(null,[]);
    state.token++; state.queryToken++; revoke();
    state.docs = []; state.entries.clear(); state.resources.clear(); state.records = [];
    state.printKeys=null;state.exportKeys=[];state.current = null; state.branches.clear(); state.undo = []; state.redo = []; state.opened.clear(); state.limits.clear(); state.cache.clear(); state.notices = [];
    state.search={query:'',hits:[],cursor:-1};state.listLimit=200;updateSearchPosition();
    state.editMode=false;state.modeChanging=false;state.viewSort=null;state.stars.clear();state.addedEntries.clear();state.importDocs.clear();state.deleted.clear();state.selected.clear();state.multi=false;state.order=[];state.sort='updated';state.orderModified=false;updateSelection();
    state.savedFileEdits=new Map();state.inputTexts=new Map();state.downloadFiles=null;state.downloadHistory=null;state.downloadJournal=null;state.downloadRevision=0;
    state.selectionAnchor=null;audit?.reset();state.downloadAudit=null;state.source=null;state.fileHandle=null;state.savedSign='';state.downloadPending=false;state.downloadSign='';updateSourceInfo();
  }
  function effectiveDocuments(){
    if(!state.importDocs.size)return state.docs;
    const active=new Set(activeRecords().map(r=>r.doc.path));
    return state.docs.filter(doc=>!state.importDocs.has(doc.path)||state.entries.has(doc.path)||active.has(doc.path));
  }
  const dirty = () => state.docs.reduce((n, doc) => n + doc.changes.size, 0)+state.deleted.size+effectiveDocuments().filter(doc=>state.importDocs.has(doc.path)&&!state.entries.has(doc.path)).length+(state.orderModified?1:0)+(state.editMode!==state.savedMode?1:0)+(JSON.stringify([...state.stars].sort())!==state.savedStars?1:0)+((state.structuralRevision||0)!==(state.savedStructuralRevision||0)?1:0);
  const signature=()=>{
    const docs=effectiveDocuments(),kept=new Set(docs),deletions=state.records.filter(r=>kept.has(r.doc)&&state.deleted.has(r.key)).map(r=>r.key);
    return JSON.stringify({fields:docs.map(doc=>[doc.path,[...doc.changes].map(([k,v])=>[k,v.value]).sort((a,b)=>a[0].localeCompare(b[0]))]),deleted:deletions.sort(),order:state.order,sort:state.sort,editMode:state.editMode,stars:[...state.stars].sort(),structural:state.structuralRevision||0});
  };
  const legacyControls=['viewer-history.json','viewer-settings.json','.viewer-backups/viewer-history.json','.viewer-backups/viewer-settings.json'];
  const statePath=path=>'.viewer-state/'+path.split('/').at(-1);
  const controlEntry=path=>state.entries.get(path)||state.entries.get('.viewer-backups/'+path.split('/').at(-1))||state.entries.get(path.split('/').at(-1));
  const needsMetadataMove=()=>legacyControls.some(path=>state.entries.has(path));
  const unsaved=()=>Boolean(state.docs.length&&(signature()!==state.savedSign||state.downloadPending||state.editMode&&(journal?.dirty||needsMetadataMove())||editorChanged()));
  function updateChanges() {
    $('changes').textContent = dirty() ? dirty() + ' 项改动 · '+(unsaved()?'草稿尚未保存':'已保存') : '原始数据未修改';
    $('document-state').textContent=unsaved()?'● 有未保存修改':'已保存 / 未修改';
    $('confirm-download').hidden=!state.downloadPending;
    updateBackupControls();if(!state.records.length)$('title').textContent=I.t('选择一个会话');
    updateEditControls();
    for(const id of ['quick-html','quick-markdown','quick-obsidian','quick-json','quick-pdf','quick-print','quick-directory','quick-zip'])$(id).disabled=!state.records.length||state.busy;
    for(const id of ['save-workspace','menu-save'])enableControls($(id),!state.editMode||!state.docs.length||state.busy,'保存');
    for(const id of ['save-as-workspace','save-as-zip-workspace','menu-save-as-directory','menu-save-as-zip'])$(id).disabled=!state.docs.length||state.busy;
    $('undo-menu').classList.toggle('disabled',!state.undo.length||editBlocked());$('redo-menu').classList.toggle('disabled',!state.redo.length||editBlocked());renderHistoryMenus();if($('history-dialog').open)showChanges(true);
  }
  let progressStage='',progressAt=0,progressHideTimer,progressShownAt=0;
  function zipProgress(stage,percent=null){
    clearTimeout(progressHideTimer);const panel=$('operation-progress');if(panel.hidden)progressShownAt=Date.now();const toolbarBottom=document.querySelector('.menu-bar')?.getBoundingClientRect?.().bottom||0;if(panel.style)panel.style.top=(Math.max(44,toolbarBottom)+8)+'px';
    const now=Date.now();if(stage===progressStage&&now-progressAt<80&&percent!==100)return;progressStage=stage;progressAt=now;
    const owner=[...document.querySelectorAll('dialog')].find(d=>d.open)||document.body;if($('operation-progress').parentElement!==owner)owner.append($('operation-progress'));
    $('operation-progress').hidden=false;I.setText?I.setText($('operation-label'),stage+(Number.isFinite(percent)?' '+Math.round(percent)+'%':'')):$('operation-label').textContent=I.t(stage);
    if(Number.isFinite(percent))$('operation-bar').value=percent;else $('operation-bar').removeAttribute('value');
  }
  function endZipProgress(){clearTimeout(progressHideTimer);progressHideTimer=setTimeout(()=>{$('operation-progress').hidden=true;progressStage=''},Math.max(0,450-(Date.now()-progressShownAt)))}
  function setBusy(value) {
    state.busy = value;if(!value)endZipProgress();
    $('new-folder').disabled = value;
    updateChanges();updateSelection();
  }
  function title(record) { return typeof record.raw.title === 'string' && record.raw.title ? record.raw.title : I.t('(无标题)'); }
  function commit(edits,allowBusy=false) {
    if (!state.editMode||editBlocked()&&!allowBusy) return;
    const tx = edits.filter(e => C.get(e.doc.data, e.path) !== e.value).map(e => ({ ...e, before: C.get(e.doc.data, e.path) }));
    if (!tx.length) return;
    for (const edit of tx) C.change(edit.doc, edit.path, edit.value);
    journal?.recordFields?.(tx,state.records);state.undo.push(audit.track(tx)); state.redo = []; state.cache.clear();state.search.query=null; updateChanges(); renderList(); renderCurrent(true);
  }
  function historyEdit(direction,count=1) {
    if(editBlocked())return;count=Math.min(state[direction].length,Math.max(1,Math.floor(Number(count)||1)));let last;
    for(let step=0;step<count;step++){
      const tx=state[direction].pop();if(!tx)break;last=tx;
      if(tx.kind==='workspace'){
        const before=state.records.find(r=>r.key===tx.target&&!state.deleted.has(r.key)),raw=before?journal?.rowRaw?.(before):null;applyWorkspace(direction==='undo'?tx.before:tx.after);const after=state.records.find(r=>r.key===tx.target&&!state.deleted.has(r.key));if(before||after)journal?.recordRaw?.(after||before,raw,after?journal.rowRaw(after):null);
      }else if(tx.kind==='delete'){for(const key of tx.keys){const r=state.records.find(r=>r.key===key);if(direction==='undo'){state.deleted.delete(key);if(r)journal?.recordRaw?.(r,null,journal.rowRaw(r))}else{if(r)journal?.recordRaw?.(r,journal.rowRaw(r),null);state.deleted.add(key)}}}
      else if(tx.kind==='star'){const starred=direction==='undo'?!tx.starred:tx.starred;starred?state.stars.add(tx.target):state.stars.delete(tx.target)}
      else if(tx.kind==='import'){
        for(const key of tx.keys){const r=state.records.find(row=>row.key===key);if(direction==='undo'){journal?.recordRaw(r,journal.rowRaw(r),null);state.deleted.add(key)}else{state.deleted.delete(key);journal?.recordRaw(r,null,journal.rowRaw(r))}}
      }
      else if(tx.kind==='order'){const before=orderState();state.order=[...(direction==='undo'?tx.before:tx.after)];state.orderModified=direction==='undo'?tx.wasModified:true;state.sort=(direction==='undo'?tx.beforeSort:tx.afterSort)||'manual';$('sort-order').value=state.sort;journal?.recordOrder?.(before,orderState())}
      else{const edits=[];for(const edit of tx){const before=C.get(edit.doc.data,edit.path),value=direction==='undo'?edit.before:edit.value;C.change(edit.doc,edit.path,value);edits.push({...edit,before,value})}journal?.recordFields?.(edits,state.records)}
      state[direction==='undo'?'redo':'undo'].push(tx);
    }
    if(!last)return;if(!current()||state.deleted.has(state.current))state.current=activeRecords()[0]?.key||null;
    state.cache.clear();state.search.query=null;updateSelection();updateChanges();renderList();renderCurrent(true);
    return focusHistoryTarget(audit.target(last),last.kind==='order');
  }
  function historyLabel(tx){
    if(tx.kind==='delete')return I.t('删除会话')+' · '+tx.keys.length;
    if(tx.kind==='star')return I.t(tx.starred?'添加星标':'取消星标');if(tx.kind==='import')return I.t('增量导入')+' · '+tx.keys.length;if(tx.kind==='order')return I.t('调整会话顺序');if(tx.kind==='workspace')return I.t('恢复会话');
    const edit=tx[0],r=state.records.find(r=>r.doc===edit?.doc&&r.index===edit?.path[0]);return I.t(edit?.path[1]==='title'?'修改标题':'修改消息')+' · '+(r?.raw.title||edit?.doc.path||'')+(tx.length>1?' ('+tx.length+')':'');
  }
  function renderHistoryMenus(){
    if(!audit)return;
    for(const direction of ['undo','redo']){const list=$(direction+'-steps');list.replaceChildren();
      const entries=[...state[direction]].reverse();if(!entries.length)list.append(text('p',I.t('没有可用操作'),'muted'));
      entries.forEach((tx,index)=>{const item=button((index+1)+' · '+historyLabel(tx),()=>{closeMenus();historyEdit(direction,index+1)});item.title=I.t(direction==='undo'?'撤销':'重做')+' '+(index+1);item.disabled=editBlocked();list.append(item)});
    }
  }
  async function focusHistoryTarget(target,listOnly=false){
    const token=state.historyFocusToken=(state.historyFocusToken||0)+1,r=state.records.find(r=>r.key===target?.record);if(!r)return;
    if(state.deleted.has(r.key)){notify('已删除：'+title(r)+'；对应内容可通过撤销恢复');return}
    if(!listOnly)state.current=r.key;
    if(target.node&&!listOnly){
      let chosen=C.branch(r.raw,state.branches.get(r.key)).leaf;
      if(!C.branch(r.raw,chosen).ids.includes(target.node))chosen=C.branch(r.raw).leaves.find(leaf=>C.branch(r.raw,leaf).ids.includes(target.node))||target.node;
      state.branches.set(r.key,chosen);const message=C.nodeMap(r.raw)[target.node]?.message;if(message){const info=C.classification(message);if(info.thought)$('show-thoughts').checked=true;if(info.tool)$('show-tool').checked=true}
      state.opened.add(r.key+':'+target.node);state.limits.set(r.key+':'+chosen,C.branch(r.raw,chosen).ids.indexOf(target.node)+1);
    }
    await renderList();if(token!==state.historyFocusToken)return;
    if(!(state.visibleKeys||[]).includes(r.key)){$('search').value='';await renderList()}
    state.listLimit=Math.max(state.listLimit||200,(state.visibleKeys||[]).indexOf(r.key)+1);await renderList();if(token!==state.historyFocusToken)return;
    if(!listOnly)await renderCurrent();if(token!==state.historyFocusToken)return;
    const item=[...$('conv-list').querySelectorAll('.conv-item')].find(el=>el.dataset.key===r.key);
    let destination=listOnly?item:target.node?[...$('msgs').querySelectorAll('article')].find(el=>el.dataset.node===target.node):$('title');
    const details=destination?.querySelector('details.thought-block,details.tool-block');if(details){details._viewerPopulate?.();details.open=true}
    destination?.scrollIntoView?.({block:'center',behavior:'auto'});item?.scrollIntoView?.({block:'nearest',behavior:'auto'});
    if(destination){destination.classList.toggle('history-focus',true);setTimeout(()=>destination.classList.remove('history-focus'),1800)}
  }
  function showChanges(refresh=false){
    if(!audit)return;if(refresh!==true)flushEditor();const info=audit.info();$('history-source').textContent=I.t('当前资料')+'：'+(state.source?.name||'')+(info.savedAt?' · '+I.t('最近保存到')+' '+info.destination+' · '+new Date(info.savedAt).toLocaleString(I.locale()):' · '+I.t('保存基准为打开时的版本'));
    const changes=audit.changes(),list=$('changes-list');list.replaceChildren();$('changes-heading').textContent='当前未保存的改动（'+changes.length+'）';
    for(const change of changes){
      const record=state.records.find(r=>r.key===change.target?.record),before=String(change.before??''),after=String(change.after??'');let first=0;while(first<before.length&&first<after.length&&before[first]===after[first])first++;const start=Math.max(0,first-60),slice=value=>(start?'…':'')+value.slice(start,start+300)+(value.length>start+300?'…':'');
      const item=text('div','','change-item'),jump=button(I.t(change.label)+(record?' · '+title(record):'')+' · '+change.file,()=>{$('history-dialog').close();focusHistoryTarget(change.target)});item.append(jump,text('pre',I.t('保存版本')+'：'+slice(before)+'\n'+I.t('当前内容')+'：'+slice(after),'change-value'));
      if(before.length>300||after.length>300){const full=text('details','','full-change');full.append(uiText('summary', '展开完整对照'));full.addEventListener('toggle',()=>{if(full.open&&!full.dataset.loaded){full.dataset.loaded='1';full.append(text('pre',I.t('保存版本')+'：\n'+before+'\n\n'+I.t('当前内容')+'：\n'+after,'change-value'))}});item.append(full)}list.append(item);
    }
    if(!changes.length)list.append(text('p',I.t('当前内容与保存版本一致。'),'muted'));
    const logs=$('history-list');logs.replaceChildren();for(const tx of [...audit.log].reverse()){const item=text('div','','audit-item');item.append(button(historyLabel(tx),()=>{$('history-dialog').close();focusHistoryTarget(audit.target(tx),tx.kind==='order')}),text('span',I.t(audit.status(tx)),'audit-status'),text('small',new Date(tx.historyTime).toLocaleString(I.locale())));logs.append(item)}
    if(!audit.log.length)logs.append(uiText('p', '本次打开后还没有编辑操作。','muted'));if(!$('history-dialog').open)$('history-dialog').showModal();
  }
  function editDialog(label, fields, save, rich=false, anchor=null) {
    if (editBlocked()) return;
    const dialog = $('editor'), form = $('edit-fields'); form.replaceChildren(); $('editor-title').textContent = label;
    for(const editor of activeEditors)editor.destroy();activeEditors=[];
    const inputs = fields.map(field => {
      const fieldLabel=({text:'正文',content:'正文',result:'结果',summary:'摘要',user_instructions:'自定义指令',user_profile:'用户资料'})[field.label]||field.label;const wrapper=text('div','','edit-field');wrapper.append(uiText('div',fieldLabel));
      if(rich&&typeof ViewerEditor!=='undefined'){
        const host=document.createElement('div');wrapper.append(host);form.append(wrapper);
        try{const editor=ViewerEditor.create(host,field.value,error=>notify('图片插入失败：'+error.message,true));activeEditors.push(editor);return {get value(){return editor.get()},focus:()=>editor.editor.focus(),seek:offset=>editor.seek(offset)}}
        catch(error){host.remove();notify('可视化编辑器未能启动，已保留源码编辑：'+error.message,true)}
      }
      const input = document.createElement('textarea');
      input.value = field.value; input.rows = fields.length === 1 ? 14 : 6; input.spellcheck = false;
      wrapper.append(input); form.append(wrapper); return input;
    });
    editorChanged=()=>inputs.some((input,i)=>input.value!==fields[i].value);
    $('save-edit').onclick = () => { save(inputs.map(input => input.value));editorChanged=()=>false;dialog.close();for(const editor of activeEditors)editor.destroy();activeEditors=[];updateChanges(); };
    for(const input of form.querySelectorAll('textarea'))input.addEventListener('input',updateChanges);for(const editor of activeEditors)editor.editor.on?.('change',updateChanges);
    dialog.showModal();const selected=inputs[anchor?.field||0]||inputs[0];if(selected)selected.focus();
    if(anchor&&selected){const locate=()=>{if(!dialog.open)return;if(selected.seek)selected.seek(anchor.offset);else N.positionTextarea(selected,anchor.offset)};if(window.requestAnimationFrame)window.requestAnimationFrame(locate);else locate()}
  }
  function editTitle() {
    const record = current(); if (!record || typeof record.raw.title !== 'string') return;
    editDialog('编辑会话标题', [{ label: '标题', value: record.raw.title }], values => commit([
      { doc: record.doc, path: [record.index, 'title'], value: values[0] },
    ]));
  }
  function editMessage(record, nodeID, message) {
    const fields = C.editable(message); if (!fields.length) return;
    const article=[...$('msgs').querySelectorAll('article[data-node]')].find(el=>el.dataset.node===nodeID),anchor=N.editorAnchor($('chat-container'),article?.querySelector('.msg-content'),fields);
    editDialog('编辑消息文字', fields, values => commit(fields.map((f, i) => ({
      doc: record.doc, path: [record.index, 'mapping', nodeID, 'message', ...f.path], value: values[i],
    }))),message.author?.role==='assistant'&&['text','multimodal_text'].includes(message.content?.content_type),anchor);
  }
  // Allowlisted, freshly constructed DOM: no imported attributes or event handlers.
  const allowed = new Set('P BR HR BLOCKQUOTE PRE CODE UL OL LI TABLE THEAD TBODY TFOOT TR TH TD STRONG EM DEL S B I H1 H2 H3 H4 H5 H6 A IMG SPAN DIV SUP SUB KBD'.split(' '));
  const drop = new Set('SCRIPT STYLE IFRAME FRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON TEXTAREA SELECT OPTION LINK META BASE AUDIO VIDEO SOURCE'.split(' '));
  function sanitize(html) {
    // DOMParser's detached document is never attached. Reconstruct only the allowlist.
    const template = document.createElement('template'); template.innerHTML = html;
    const fragment = document.createDocumentFragment();
    function copy(node, parent, depth) {
      if (depth > 150) return;
      if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || drop.has(node.tagName)) return;
      if (!allowed.has(node.tagName)) { for (const child of node.childNodes) copy(child, parent, depth + 1); return; }
      if (node.tagName === 'IMG') {
        const src = C.safeURL(node.getAttribute('src'), 'resource');
        if (!src) {
          const link = C.safeURL(node.getAttribute('src'));
          if (link) { const a = external(link, '外部图片：' + (node.getAttribute('alt') || '点击打开')); parent.append(a); }
          else parent.append(uiText('span', '[图片地址已阻止]', 'missing'));
          return;
        }
        const image = document.createElement('img'); image.draggable=false; image.src = src; image.alt = node.getAttribute('alt') || '';
        image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; parent.append(image); return;
      }
      if(node.tagName==='SPAN'&&['外部图片：','点击打开','[图片地址已阻止]'].includes(node.getAttribute('data-viewer-ui'))){parent.append(uiText('span',node.getAttribute('data-viewer-ui')));return}
      const out = document.createElement(node.tagName.toLowerCase());
      if(node.tagName==='SPAN'&&node.classList.contains('math-slot')){
        out.className='math-slot';out.dataset.tex=node.getAttribute('data-tex')||'';out.dataset.display=node.getAttribute('data-display')||'0';
      }
      if(node.tagName==='SPAN'&&node.classList.contains('export-citation')){out.className='export-citation';out.title=node.getAttribute('title')||''}
      if (node.tagName === 'A') {
        const href = C.safeURL(node.getAttribute('href'));
        if (href) { out.href = href; out.target = '_blank'; out.rel = 'noopener noreferrer'; out.referrerPolicy = 'no-referrer'; }
      }
      if (['TH', 'TD'].includes(node.tagName)) for (const attr of ['colspan', 'rowspan']) {
        const value = Number(node.getAttribute(attr)); if (value >= 1 && value <= 100) out.setAttribute(attr, String(value));
      }
      for (const child of node.childNodes) copy(child, out, depth + 1);
      parent.append(out);
    }
    for (const node of template.content.childNodes) copy(node, fragment, 0);
    return fragment;
  }
  function external(url, label) {
    const href = C.safeURL(url); if (!href) return text('span', label + '（链接已阻止）');
    const a = text('a', label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; return a;
  }
  function markdown(value, message) {
    const wrapper = document.createElement('div');
    try { wrapper.append(sanitize(ViewerMarkdown.render(value,{message,breaks:C.classification(message).role==='user'}))); }
    catch (_) { wrapper.append(text('pre', value)); }
    for(const slot of wrapper.querySelectorAll('.math-slot')){
      try{katex.render(decodeURIComponent(slot.dataset.tex),slot,{displayMode:slot.dataset.display==='1',throwOnError:false,trust:false,strict:'warn',maxExpand:1000,maxSize:20})}
      catch(error){slot.classList.add('math-error');slot.title=error.message}
    }
    for (const table of wrapper.querySelectorAll('table')) { const box = text('div', '', 'table-wrap'); table.replaceWith(box); box.append(table); }
    for (const pre of wrapper.querySelectorAll('pre')) {
      const code = pre.querySelector('code'); if (!code) continue;
      const copy = button('复制代码', async () => {
        try { await navigator.clipboard.writeText(code.textContent); copy.dataset.copied='1';I.setText?I.setText(copy,'已复制'):copy.textContent=I.t('已复制'); }
        catch (_) { notify('浏览器不允许自动复制，请选中代码后复制'); }
      }, 'copy-code'); const box=text('div','','code-block'),tools=text('div','','code-tools');pre.replaceWith(box);tools.append(copy);box.append(tools,pre);
    }
    return wrapper;
  }
  function sniff(bytes) {
    const a = [...bytes.slice(0, 16)], str = String.fromCharCode(...a);
    if (a[0] === 0x89 && str.slice(1, 4) === 'PNG') return 'image/png';
    if (a[0] === 0xFF && a[1] === 0xD8 && a[2] === 0xFF) return 'image/jpeg';
    if (str.startsWith('GIF8')) return 'image/gif';
    if (str.startsWith('RIFF') && str.slice(8, 12) === 'WEBP') return 'image/webp';
    if (str.startsWith('RIFF') && str.slice(8, 12) === 'WAVE') return 'audio/wav';
    if (str.startsWith('%PDF-')) return 'application/pdf';
    if (str.startsWith('OggS')) return 'audio/ogg';
    if (str.startsWith('ID3') || (a[0] === 0xFF && (a[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
    if (str.startsWith('fLaC')) return 'audio/flac';
    return '';
  }
  function mimeByName(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return ({ png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',
      wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',
      txt:'text/plain',md:'text/plain' })[ext] || '';
  }
  async function resourceBlob(entry, name, hint) {
    if (!entry.blob) throw new Error('附件不可用');
    const bytes = new Uint8Array(await entry.blob.slice(0, 32).arrayBuffer());
    const mime = sniff(bytes) || hint || entry.mime || mimeByName(name) || entry.blob.type || 'application/octet-stream';
    return { blob: entry.blob.slice(0, entry.blob.size, mime), mime };
  }
  function asset(block) {
    const container = text('div', '', 'asset'), entry = state.resources.get(block.id);
    if (!entry) { container.append(uiText('span', '附件缺失：' + (block.name || block.id), 'missing')); return container; }
    const name = block.name || entry.name || entry.path.split('/').pop();
    const details = text('details', '', 'attachment-block'), summary = text('summary', '📎 ' + name);
    details.append(summary); container.append(details);
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return; loaded = true;
      const body = uiText('div', '正在读取附件…', 'asset-body'); details.append(body);
      const loadVersion = state.loadToken;
      try {
        const { blob, mime } = await resourceBlob(entry, name, block.mime);
        if (loadVersion !== state.loadToken || !details.isConnected) return;
        let url = entry.urls && entry.urls.get(mime);
        if (!url) { url = URL.createObjectURL(blob); state.urls.add(url); if (!entry.urls) entry.urls = new Map(); entry.urls.set(mime, url); }
        body.replaceChildren();
        if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) {
          const image = document.createElement('img'); image.draggable=false; image.src = url; image.alt = name; image.loading = 'lazy';
          image.addEventListener('error', () => body.append(uiText('p', '浏览器无法预览此图片，请下载查看', 'missing')), { once: true }); body.append(image);
        } else if (/^(audio|video)\//.test(mime)) {
          const media = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video'); media.controls = true; media.preload = 'metadata'; media.src = url; body.append(media);
        }
        const download = uiText('a', '下载 ' + name); download.href = url; download.download = name; body.append(download);
      } catch (error) { I.setText(body,'读取失败：' + error.message); loaded = false; }
    });
    // Image/audio parts appear inline, while general documents stay collapsed.
    if (['image', 'audio'].includes(block.kind)) details.open = true;
    return container;
  }
  function fillBody(body, message) {
    const list = C.blocks(message);
    if (!list.length) body.append(uiText('p', '（空消息）', 'muted'));
    for (const block of list) {
      if (block.type === 'markdown') body.append(markdown(block.text,message));
      else if (block.type === 'asset') body.append(asset(block));
      else if (block.type === 'link') body.append(external(block.url, block.text));
      else body.append(text('pre', block.text, 'raw-data'));
    }
    const refs = C.references(message);
    if (refs.length) {
      const details = document.createElement('details'); details.className='reference-block';details.append(uiText('summary', '参考资料（' + refs.length + '）'));
      details.addEventListener('toggle', () => {
        if (!details.open || details.dataset.loaded) return; details.dataset.loaded = '1';
        const ul = document.createElement('ul');
        for (const ref of refs) { const li = document.createElement('li'); li.append(external(ref.url, ref.title)); ul.append(li); }
        details.append(ul);
      }); body.append(details);
    }
  }
  function toolLabel(info) {
    if (info.type === 'code') return '执行代码'; if (info.type === 'execution_output') return '代码输出';
    if (['system','developer'].includes(info.role)) return '系统消息';
    if (info.type === 'user_editable_context') return '自定义指令'; return '工具记录';
  }
  function messageElement(record, id, message) {
    const info = C.classification(message), article = text('article', '', 'msg ' + (info.role === 'user' ? 'user' : 'assistant'));
    article.dataset.node = id;
    const panel = text('div', '', 'message-panel'), header = text('div', '', 'message-header');
    header.append(text('span', ({user:'你',assistant:'助手',tool:'工具',system:'系统',developer:'系统',function:'工具'})[info.role] || info.role));
    const ts = format(message.create_time); if (ts){const time=text('time',ts);time.dataset.timestamp=message.create_time;header.append(time);}
    const fields = C.editable(message);
    if (fields.length) { const edit = button('编辑', () => editMessage(record, id, message), 'message-edit'); enableControls(edit,editBlocked(),'编辑'); header.append(edit); }
    panel.append(header);
    const body = text('div', '', 'msg-content');
    if (info.thought || info.tool) {
      const details = text('details', '', info.thought ? 'thought-block' : 'tool-block');
      const raw = C.blocks(message).map(b => b.text || '').join(' ').replace(/\s+/g, ' ').trim();
      const label = info.thought ? (info.type === 'reasoning_recap' ? '思考摘要：' + raw.slice(0,80) + (raw.length > 80 ? '…' : '') : '思考记录') : toolLabel(info);
      details.append(uiText('summary', label));
      const openKey = record.key + ':' + id;
      let rendered = false;
      const populate = () => { if (!rendered) { fillBody(body, message); details.append(body); rendered = true; paintVisibleResults(); } };
      details._viewerPopulate=populate;
      details.addEventListener('toggle', () => { if (details.open) { state.opened.add(openKey); populate(); } else state.opened.delete(openKey); });
      if (state.opened.has(openKey)) { populate(); details.open = true; }
      panel.append(details);
    } else { fillBody(body, message); panel.append(body); }
    const model = (message.metadata || {}).model_slug;
    if (typeof model === 'string' && model) panel.append(text('div', model, 'model-badge'));
    if (state.branches.get(record.key) === '__all__') panel.append(uiText('small', '节点 ' + id, 'muted'));
    article.append(panel); return article;
  }
  const current = () => state.records.find(r => r.key === state.current);
  const activeRecords=()=>state.records.filter(r=>!state.deleted.has(r.key));
  function orderedRecords(view=true){
    const sort=view?displaySort():state.sort,rows=activeRecords(),rank=new Map(state.order.map((key,i)=>[key,i]));
    return rows.sort((a,b)=>{
      if(sort==='manual')return (rank.get(a.key)??1e9)-(rank.get(b.key)??1e9);
      if(sort==='title')return TitleIndex.compare(title(a),title(b))||a.key.localeCompare(b.key);
      const time=r=>C.timestamp(sort==='updated'?r.raw.update_time||r.raw.create_time:r.raw.create_time);
      return sort==='oldest'?time(a)-time(b):time(b)-time(a);
    });
  }
  function updateSelection(){
    $('multi-toggle').dataset.enterLabel=I.t('多选');$('multi-toggle').dataset.exitLabel=I.t('退出多选');
    $('selection-tools').hidden=false;$('multi-toggle').textContent=state.multi?'退出多选':'多选';
    const records=activeRecords(),total=records.length;
    const count=state.multi?'已选 '+state.selected.size+' / '+total+' 项':
      $('search').value?'匹配 '+(state.visibleKeys||[]).length+' / '+total+' 个会话':'共 '+total+' 个会话';
    I.setText($('selection-count'),count);
    $('select-starred').disabled=state.busy||!records.some(record=>state.stars.has(record.key));
    $('selection-export').disabled=!state.selected.size||state.busy;enableControls($('selection-delete'),!state.selected.size||editBlocked(),'删除所选');
    $('select-invert').disabled=!(state.visibleKeys||[]).length||state.busy;$('select-none').disabled=!state.selected.size||state.busy;$('select-visible').disabled=!state.records.length||state.busy;
  }
  function selectRange(key,checked,range=false){
    if(state.busy)return;const visible=state.visibleKeys||[],start=visible.indexOf(state.selectionAnchor),end=visible.indexOf(key);
    const keys=range&&start>=0&&end>=0?visible.slice(Math.min(start,end),Math.max(start,end)+1):[key];
    for(const item of keys)checked?state.selected.add(item):state.selected.delete(item);
    if(!range||start<0)state.selectionAnchor=key;updateSelection();renderList();
  }
  function deleteRecords(keys,allowBusy=false){
    if(!state.editMode||editBlocked()&&!allowBusy)return;
    keys=[...new Set(keys)].filter(key=>!state.deleted.has(key));if(!keys.length)return;
    // Reversible draft deletion needs no second confirmation; permanent history deletion still does.
    for(const key of keys){const r=state.records.find(r=>r.key===key);if(r)journal?.recordRaw?.(r,journal.rowRaw(r),null);state.deleted.add(key)}
    state.undo.push(audit.track({kind:'delete',keys}));state.redo=[];state.selected.clear();state.search.query=null;
    if(state.deleted.has(state.current))state.current=activeRecords()[0]?.key||null;
    updateSelection();updateChanges();renderList();renderCurrent();
  }
  function toggleStar(key){
    if(editBlocked()||!key||state.deleted.has(key))return;
    const starred=!state.stars.has(key);starred?state.stars.add(key):state.stars.delete(key);
    state.undo.push(audit.track({kind:'star',target:key,starred}));state.redo=[];updateChanges();renderList();
  }
  function moveRecord(from,to){
    if(editBlocked())return;
    if(from===to)return;const beforeSort=state.sort,beforeState=orderState(),before=[...state.order],wasModified=state.orderModified,after=orderedRecords().map(r=>r.key).filter(key=>key!==from),index=after.indexOf(to);
    if((index<0&&to!=='__end__')||!activeRecords().some(r=>r.key===from))return;after.splice(to==='__end__'?after.length:index,0,from);
    state.order=after;state.sort='manual';state.orderModified=true;$('sort-order').value='manual';
    journal?.recordOrder?.(beforeState,orderState());state.undo.push(audit.track({kind:'order',before,after:[...after],beforeSort,afterSort:'manual',wasModified,target:from}));state.redo=[];updateChanges();renderList();
  }
  function branchLabel(record, id) {
    const m = (C.nodeMap(record.raw)[id] || {}).message;
    const excerpt = m ? C.blocks(m).map(b => b.text || b.name || '').join(' ').replace(/\s+/g,' ').slice(0,50) : id;
    return (I.t(id === record.raw.current_node ? '当前分支' : '其他分支')+' · ') + (excerpt || id.slice(0,12));
  }
  async function renderCurrent(preserve = false, resume = false) {
    rememberReading();removeReadingRestore();
    state.printReady=false;
    const token = ++state.token, record = current(), list = $('msgs');
    if (!record) { displayedReading=null;turnOutline?.set(null,[]);list.replaceChildren(uiText('div', '选择一个会话开始浏览', 'empty')); return; }
    const container=$('chat-container');
    const leaf=C.branch(record.raw,state.branches.get(record.key)).leaf,key=readingKey(record,leaf),savedReading=resume?readingMap().get(key):null;
    const anchor=preserve&&displayedReading?.key===key?N.capture(container,id=>{
      const message=(C.nodeMap(record.raw)[id]||{}).message;if(!message)return false;
      const info=C.classification(message);return (!info.thought||$('show-thoughts').checked)&&(!info.tool||$('show-tool').checked);
    }):savedReading?.anchor||null;
    const scrollGuard=state.userScroll;
    $('title').textContent = title(record); $('meta').textContent = format(record.raw.update_time || record.raw.create_time);
    updateEditControls();
    const branch = C.branch(record.raw, state.branches.get(record.key));
    const select = $('branch'); select.replaceChildren();
    const choices = [...new Set([branch.leaf === '__all__' ? record.raw.current_node : branch.leaf, ...branch.leaves])].filter(Boolean);
    for (const id of choices) { const option = text('option', branchLabel(record,id)); option.value = id; select.append(option); }
    const all = text('option', I.t('全部分支（按时间显示）')); all.value = '__all__'; select.append(all); select.value = branch.leaf;
    const warnings = [...state.notices, ...branch.warnings];
    $('warnings').textContent = warnings.join('；'); $('warnings').hidden = !warnings.length;
    const nodes = C.nodeMap(record.raw), rows = branch.ids.filter(id => C.object(nodes[id]) && C.object(nodes[id].message));
    const filtered = rows.filter(id => { const info = C.classification(nodes[id].message); return (!info.thought || $('show-thoughts').checked) && (!info.tool || $('show-tool').checked); });
    turnOutline?.set(record,ViewerOutline.turns(record,filtered,plainText));
    list.replaceChildren();
    if (!filtered.length) list.append(uiText('div', '此分支没有符合显示条件的消息，可调整上方开关', 'empty'));
    let rendered = 0;
    const limitKey = record.key + ':' + branch.leaf;
    function appendBatch(amount = 40) {
      const fragment = document.createDocumentFragment(), end = Math.min(rendered + amount, filtered.length);
      while (rendered < end) { const id = filtered[rendered++]; fragment.append(messageElement(record,id,nodes[id].message)); }
      list.append(fragment);
      paintVisibleResults();
      turnOutline?.refresh();
      $('msg-count').textContent = '已显示 ' + rendered + ' / ' + filtered.length + ' · 分支 ' + rows.length + ' 条';
    }
    const anchorPosition=anchor?.node?filtered.indexOf(anchor.node)+1:0;
    appendBatch(Math.max(state.limits.get(limitKey)||40,savedReading?.limit||0,Math.ceil(anchorPosition/40)*40));
    const more = button('加载更多消息', () => {
      if (token !== state.token) return;
      const oldTop = $('chat-container').scrollTop; more.remove(); appendBatch();
      state.limits.set(limitKey,rendered);
      if (rendered < filtered.length) list.append(more);
      $('chat-container').scrollTop = oldTop;
    }, 'load-more');
    if (rendered < filtered.length) list.append(more);
    displayedReading={key,limitKey,limit:rendered};
    if(anchor){
      N.restore(container,anchor);
      const restore=()=>{if(token===state.token&&scrollGuard===state.userScroll)N.restore(container,anchor)};
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(restore);
      document.fonts?.ready.then(restore);container.addEventListener('load',restore,true);removeReadingRestore=()=>container.removeEventListener('load',restore,true);
    }else container.scrollTop=0;
    if(resume)rememberReading();
  }
  function groupKey(ts) {
    if (!ts) return '日期未知';
    const date = new Date(ts * 1000), now = new Date();
    const serial = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const days = (serial(now) - serial(date)) / 86400000;
    if (days < 0) return '未来日期'; if (days === 0) return '今天'; if (days === 1) return '昨天';
    if (days < 7) return '过去 7 天'; if (days < 30) return '过去 30 天';
    return new Intl.DateTimeFormat(I.locale(),{year:'numeric',month:'long'}).format(date);
  }
  async function renderList() {
    const token = ++state.queryToken, q = $('search').value, full = $('search-body').checked, options=searchOptions(), optionsKey=JSON.stringify(options);
    let matches;try{matches=Search.compile(q,options)}catch(error){state.search={query:'',hits:[],cursor:-1};updateSearchPosition();for(const node of document.querySelectorAll('.conv-title,.msg-content'))N.clear(node);notify(error.message,true);return}
    const matching = [];
    const ordered=orderedRecords();
    for (let i = 0; i < ordered.length; i++) {
      const record = ordered[i];
      let hit = !q || matches.test(title(record));
      if (!hit && full) {
        if (!state.cache.has(record.key)) state.cache.set(record.key,Object.values(C.nodeMap(record.raw)).filter(n=>C.object(n)&&C.object(n.message)).map(n=>plainText(n.message)).join('\n'));
        hit = matches.test(state.cache.get(record.key));
      }
      if (hit) matching.push(record);
      if (i % 20 === 19) { await yieldUI(); if (token !== state.queryToken) return; }
    }
    if (token !== state.queryToken) return;
    state.visibleKeys=matching.map(r=>r.key);updateSelection();$('sort-order').value=displaySort();
    const list = $('conv-list'); list.replaceChildren(); let group;
    // Render a bounded first page. The explicit button works without observers.
    let count = 0;
    const append = () => {
      const fragment = document.createDocumentFragment(), end = Math.min(count + (state.listLimit||200), matching.length);
      for (; count < end; count++) {
        const record = matching[count], g = displaySort()==='title'?TitleIndex.info(title(record)).group:groupKey(displaySort()==='updated'?record.raw.update_time||record.raw.create_time:record.raw.create_time);
        if (['updated','created','oldest','title'].includes(displaySort())&&g !== group) { group = g;const heading=text('div',g,'conv-group-title');if(displaySort()==='title'){heading.dataset.letter=g;heading.tabIndex=-1}fragment.append(heading); }
        const row=text('div','','conv-row');
        if(state.multi){const hit=text('label','','selection-hit'),check=document.createElement('input');check.type='checkbox';check.checked=state.selected.has(record.key);check.setAttribute('aria-label','选择 '+title(record));hit.append(check);hit.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();selectRange(record.key,!state.selected.has(record.key),event.shiftKey)});check.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();selectRange(record.key,!state.selected.has(record.key),event.shiftKey)}});row.append(hit)}
        if(state.editMode&&displaySort()==='manual'){
          const grip=button('⠿',()=>{},'drag-grip');grip.draggable=true;I.setAttribute(grip,'title','拖动调整显示顺序，不改变聊天日期');grip.addEventListener('dragstart',event=>{event.dataTransfer.setData('application/x-viewer-record',record.key);event.dataTransfer.effectAllowed='move';event.stopPropagation()});row.append(grip);
          row.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('application/x-viewer-record')){event.preventDefault();event.stopPropagation()}});
          row.addEventListener('drop',event=>{const from=event.dataTransfer.getData('application/x-viewer-record');if(from){event.preventDefault();event.stopPropagation();moveRecord(from,record.key)}});
        }
        const item = button('', () => selectRecord(record.key), 'conv-item' + (record.key === state.current ? ' active' : ''));
        const titleNode=text('span',title(record),'conv-title');item.append(titleNode);if(q)N.highlight(titleNode,q,options);
        item.dataset.key = record.key; item.title = title(record) + '\n' + record.doc.path;row.append(item);
        if(state.editMode&&journal?.has(record.historyUid)){const versions=button('',()=>showBackups('edit',record.historyUid),'conversation-history icon-button');versions.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 10a8 8 0 1 1 0 5M4 4v6h6m2-3v5l3 2"/></svg>';versions.title=I.t('恢复会话版本');versions.setAttribute('aria-label',I.t('恢复会话版本'));row.append(versions)}
        const starred=state.stars.has(record.key),star=button('',()=>toggleStar(record.key),'conversation-star icon-button');
        star.textContent=starred?'★':'☆';star.setAttribute('aria-pressed',String(starred));I.setAttribute(star,'aria-label',starred?'取消星标':'添加星标');enableControls(star,editBlocked(),starred?'取消星标':'添加星标');row.append(star);
        const menu=document.createElement('details');menu.className='conversation-menu';const summary=text('summary','⋯');I.setAttribute(summary,'aria-label','聊天操作：'+title(record));menu.append(summary);
        const actions=text('div','','conversation-popup');const remove=button('删除本条聊天',()=>{menu.open=false;deleteRecords([record.key])},'conversation-delete');enableControls(remove,editBlocked(),'删除本条聊天');actions.append(button('导出本条聊天…',()=>{menu.open=false;openExport([record.key],'zip')}),remove);menu.append(actions);row.append(menu);fragment.append(row);
        menu.addEventListener('toggle',()=>{
          if(!menu.open)return;for(const other of $('conv-list').querySelectorAll('.conversation-menu'))if(other!==menu)other.open=false;
          if(typeof summary.getBoundingClientRect!=='function')return;
          const rect=summary.getBoundingClientRect();actions.style.position='fixed';actions.style.left=Math.max(4,Math.min(rect.right-180,(window.innerWidth||1000)-190))+'px';
          const height=actions.offsetHeight||100;actions.style.top=(rect.bottom+height>(window.innerHeight||800)?Math.max(4,rect.top-height):rect.bottom)+'px';
        });
      }
      list.append(fragment);
    };
    append();
    const more = button('加载更多会话', () => { if (token !== state.queryToken) return; more.remove(); append();state.listLimit=count; if (count < matching.length) list.append(more); }, 'load-more');
    if (count < matching.length) list.append(more);
    if(state.editMode&&displaySort()==='manual'){
      const end=uiText('div', '拖到这里放在最后','drag-end');
      end.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('application/x-viewer-record')){event.preventDefault();event.stopPropagation()}});
      end.addEventListener('drop',event=>{const from=event.dataTransfer.getData('application/x-viewer-record');if(from){event.preventDefault();event.stopPropagation();moveRecord(from,'__end__')}});list.append(end);
    }
    const rail=$('alphabet-index');rail.replaceChildren();rail.hidden=displaySort()!=='title';$('conv-list-wrap').classList.toggle('has-alphabet',displaySort()==='title');
    if(displaySort()==='title'){
      const available=new Set(matching.map(r=>TitleIndex.info(title(r)).group));
      for(const letter of TitleIndex.letters){const item=button(letter,async()=>{
        const position=matching.findIndex(r=>TitleIndex.info(title(r)).group===letter);if(position<0)return;
        state.listLimit=Math.max(state.listLimit||200,position+1);await renderList();
        const heading=[...$('conv-list').querySelectorAll('[data-letter]')].find(el=>el.dataset.letter===letter);heading?.scrollIntoView({block:'start'});heading?.focus?.({preventScroll:true});
      },'alphabet-letter');item.disabled=!available.has(letter);item.setAttribute('aria-label',letter);rail.append(item)}
    }
    if(q!==state.search.query||full!==state.search.full||optionsKey!==state.search.optionsKey)await rebuildSearch(q,full,token,options,optionsKey);
    paintVisibleResults();
  }
  function plainText(message){
    const out=[];
    for(const block of C.blocks(message)){
      if(block.type==='markdown'){
        const template=document.createElement('template');template.innerHTML=ViewerMarkdown.render(block.text);
        for(const math of template.content.querySelectorAll('.math-slot'))math.remove();
        out.push([...template.content.childNodes].map(n=>n.textContent||'').join(''));
      }else if(block.type==='raw'||block.type==='link')out.push(block.text||'');
    }
    return out.join('\n');
  }
  function searchOptions(){return {mode:$('search-mode').value,caseSensitive:$('search-case').checked,wholeWord:$('search-whole').checked,diacritics:$('search-accents').checked,locale:I.locale()}}
  async function rebuildSearch(query,full,token,options=searchOptions(),optionsKey=JSON.stringify(options)){
    const hits=[];
    const records=orderedRecords();if(query)for(let i=0;i<records.length;i++){
      const r=records[i];
      for(const [ordinal,hit] of N.occurrences(title(r),query,options).entries())hits.push({record:r.key,kind:'title',ordinal,...hit});
      if(full)for(const [id,node] of Object.entries(C.nodeMap(r.raw))){
        if(!C.object(node)||!C.object(node.message))continue;
        for(const [ordinal,hit] of N.occurrences(plainText(node.message),query,options).entries())hits.push({record:r.key,node:id,kind:'body',ordinal,...hit});
      }
      if(i%8===7){await yieldUI();if(token!==state.queryToken)return}
    }
    if(token!==state.queryToken)return;
    state.search={query,full,hits,cursor:-1,options,optionsKey};updateSearchPosition();
  }
  function updateSearchPosition(){
    const s=state.search;$('search-navigation').hidden=!s.query;
    $('search-query-label').textContent=I.t('查找')+'：'+s.query;
    $('search-position').textContent=s.hits.length?(s.cursor<0?'共 '+s.hits.length+' 处':(s.cursor+1)+' / '+s.hits.length):'没有搜索结果';
    $('search-prev').disabled=$('search-next').disabled=!s.hits.length;
  }
  function paintVisibleResults(){
    const s=state.search;if(!s.query||!s.full){for(const body of $('msgs').querySelectorAll('.msg-content'))N.clear(body);return}
    for(const body of $('msgs').querySelectorAll('.msg-content'))N.highlight(body,s.query,s.options);
    const hit=s.hits[s.cursor];if(!hit||hit.record!==state.current)return;
    if(hit.kind==='body'){
      const article=[...$('msgs').querySelectorAll('article')].find(a=>a.dataset.node===hit.node);
      const marks=article?[...article.querySelectorAll('mark.search-hit')].filter(m=>m.dataset.match===String(hit.ordinal)):[];
      for(const mark of marks)mark.classList.add('current-hit');
    }
  }
  async function navigateSearch(step){
    const s=state.search;if(!s.hits.length)return;
    s.cursor=s.cursor<0?(step<0?s.hits.length-1:0):N.wrap(s.cursor,step,s.hits.length);
    const hit=s.hits[s.cursor],r=state.records.find(r=>r.key===hit.record);if(!r)return;
    if(hit.kind==='body'){
      let chosen=C.branch(r.raw).leaf;
      if(!C.branch(r.raw,chosen).ids.includes(hit.node))chosen=C.branch(r.raw).leaves.find(leaf=>C.branch(r.raw,leaf).ids.includes(hit.node))||hit.node;
      state.branches.set(r.key,chosen);
      const info=C.classification(C.nodeMap(r.raw)[hit.node].message);
      if(info.thought)$('show-thoughts').checked=true;if(info.tool)$('show-tool').checked=true;
      state.opened.add(r.key+':'+hit.node);
      state.limits.set(r.key+':'+chosen,C.branch(r.raw,chosen).ids.length);
    }
    state.current=r.key;state.listLimit=Math.max(state.listLimit||200,(state.visibleKeys||[]).indexOf(r.key)+1);await renderCurrent();await renderList();
    let target;
    if(hit.kind==='body'){
      const article=[...$('msgs').querySelectorAll('article')].find(a=>a.dataset.node===hit.node);
      if(article){const details=article.querySelector('details.thought-block,details.tool-block');if(details){details._viewerPopulate?.();details.open=true}paintVisibleResults();target=article.querySelector('mark.current-hit')||article}
    }else{
      const item=[...$('conv-list').querySelectorAll('.conv-item')].find(a=>a.dataset.key===r.key);
      target=item?.querySelectorAll('mark.search-hit')[hit.ordinal]||item;
      if(target)target.classList.add('current-hit');
    }
    target?.scrollIntoView({block:'center',behavior:'auto'});updateSearchPosition();
  }
  function selectRecord(key, push = true) {
    if (!state.records.some(r => r.key === key)||state.deleted.has(key)) return;
    state.current = key;
    for (const item of $('conv-list').querySelectorAll('.conv-item')) item.classList.toggle('active', item.dataset.key === key);
    if(narrowSidebar?.matches)setSidebarOpen(false);
    if (push) history.pushState(null, '', '#' + encodeURIComponent(key));
    renderCurrent(false,true);
  }
  async function fromHash() {
    let hash = ''; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { notify('地址栏中的会话标识无效，已忽略'); }
    const linked=hash?activeRecords().find(r=>r.key===hash||r.id===hash):null,previous=linked?null:lastReading();
    const record=linked||previous?.record||activeRecords()[0];if(!record)return;
    if(previous?.leaf&&C.branch(record.raw,previous.leaf).leaf===previous.leaf)state.branches.set(record.key,previous.leaf);
    const listed=()=>[...$('conv-list').querySelectorAll('.conv-item')].find(item=>item.dataset.key===record.key);
    if(!listed()){state.listLimit=Math.max(state.listLimit||200,(state.visibleKeys||[]).indexOf(record.key)+1);await renderList()}
    selectRecord(record.key,false);if(previous||linked)listed()?.scrollIntoView?.({block:'nearest'});
  }
  async function parseOffThread(texts) {
    if (!window.Worker) return texts.map(C.parse);
    let worker, url;
    try {
      url = URL.createObjectURL(new Blob([`self.onmessage=e=>{try{self.postMessage({ok:true,data:e.data.map(t=>JSON.parse(t.replace(/^\\uFEFF/,'')))})}catch(error){self.postMessage({ok:false,error:error.message})}}`], { type:'text/javascript' }));
      worker = new Worker(url);
    } catch (_) { if (url) URL.revokeObjectURL(url); return texts.map(C.parse); }
    return new Promise((resolve, reject) => {
      const finish = () => { worker.terminate(); URL.revokeObjectURL(url); };
      worker.onmessage = event => { finish(); event.data.ok ? resolve(event.data.data) : reject(new Error('聊天 JSON 无效：' + event.data.error)); };
      worker.onerror = event => {
        event.preventDefault(); finish();
        try { resolve(texts.map(C.parse)); } catch (error) { reject(error); }
      };
      worker.postMessage(texts);
    });
  }
  function entryPriority(entry) {
    const mime = mimeByName(entry.path), type = /^image\//.test(mime) ? 3 : /^(audio|video)\//.test(mime) ? 2 : mime ? 1 : 0;
    return type * 10000 - entry.path.split('/').length;
  }
  async function indexResources(entries=state.entries,resources=state.resources) {
    const aliases = new Map(), mime = new Map();
    for (const entry of entries.values()) {
      const basename = entry.path.split('/').pop();
      try {
        if (basename === 'conversation_asset_file_names.json') {
          const map = C.parse(await blobText(entry.blob));
          for (const [file, name] of Object.entries(map)) if (C.fid(file) && typeof name === 'string') aliases.set(C.fid(file), name);
        } else if (basename === 'library_files.json') {
          const list = C.parse(await blobText(entry.blob));
          for (const item of Array.isArray(list) ? list : []) if (C.object(item) && C.fid(item.file_id)) {
            if (typeof item.file_name === 'string') aliases.set(C.fid(item.file_id), item.file_name);
            if (typeof item.mime_type === 'string') mime.set(C.fid(item.file_id), item.mime_type);
          }
        }
      } catch (_) { state.notices.push(basename + ' 无法解析，附件将使用可用文件名'); }
    }
    for (const entry of [...entries.values()].sort((a,b) => a.path.localeCompare(b.path))) {
      const id = C.fid(entry.path.split('/').pop()); if (!id) continue;
      const old = resources.get(id);
      if (!old || entryPriority(entry) > entryPriority(old)) resources.set(id, { ...entry, name: aliases.get(id), mime: mime.get(id) });
    }
  }
  async function loadEntries(entries, sources, origin=null) {
    if (state.busy) return;
    flushEditor();
    if (unsaved() && !confirm(I.t('当前草稿未保存。打开其他资料会清除修改，是否继续？'))) return;
    setBusy(true); reset(); const loadToken = ++state.loadToken;
    try {
      for (const entry of entries) {
        if(IO.hidden(entry.path))continue;
        if (!C.validPath(entry.path) || state.entries.has(entry.path)) throw new Error('文件路径无效或重复：' + entry.path);
        state.entries.set(entry.path, entry);
      }
      const sourceList = sources || await Promise.all([...state.entries.values()]
        .filter(e => C.conversationFile(e.path.split('/').pop())).sort((a,b) => a.path.localeCompare(b.path))
        .map(async e => ({ path:e.path, text:await blobText(e.blob) })));
      if (!sourceList.length) throw new Error('目录中没有 conversations.json 或 conversations-*.json');
      notify('正在后台解析 ' + sourceList.length + ' 个聊天文件…'); await yieldUI();
      const parsed = await parseOffThread(sourceList.map(x => x.text));
      const seen = new Map(); let invalid = 0, duplicates = 0;
      for (let s = 0; s < sourceList.length; s++) {
        const source = sourceList[s];
        if (!C.validPath(source.path)) throw new Error('聊天文件路径无效');
        const doc = C.document(source.text, parsed[s]); doc.path = source.path; state.docs.push(doc);
        if (!state.entries.has(source.path)) state.entries.set(source.path, { path:source.path, blob:new Blob([source.text],{type:'application/json'}) });
        for (let i = 0; i < doc.data.length; i++) {
          const raw = doc.data[i];
          if (!C.object(raw) || !C.object(raw.mapping)) { invalid++; continue; }
          const id = typeof (raw.conversation_id || raw.id) === 'string' ? raw.conversation_id || raw.id : '';
          if (id && seen.has(id)) duplicates++;
          seen.set(id,true);
          // Keep duplicate records addressable: silently merging would lose divergent branches.
          state.records.push({ raw, doc, index:i, id, key:source.path + '::' + i });
          if (i % 30 === 29) await yieldUI();
        }
      }
      if (!state.records.length&&invalid&&!controlEntry('.viewer-state/viewer-history.json')) throw new Error('没有可用对话；源文件已保留，但没有有效的 mapping');
      if (invalid) state.notices.push(invalid + ' 条无效对话无法展示，导出副本仍保留原文');
      if (duplicates) state.notices.push(duplicates + ' 条重复会话 ID 已分别保留，避免合并时丢失不同版本');
      await indexResources();
      const settings=controlEntry(settingsPath);
      // Older archives may have viewer metadata without an explicit mode.
      // Treat them as editable until the user explicitly chooses to remove it.
      state.editMode=Boolean(settings||controlEntry(ViewerJournalStore.path));
      if(settings)try{
        const saved=C.parse(await blobText(settings.blob));
        if(['updated','created','oldest','title','manual'].includes(saved.sort))state.sort=saved.sort;
        if(typeof saved.editMode==='boolean')state.editMode=saved.editMode;
        const refs=new Map(state.records.map(r=>[r.key,r]));
        for(const ref of Array.isArray(saved.stars)?saved.stars:[])if(ref&&typeof ref.path==='string'&&Number.isInteger(ref.index)){
          const key=ref.path+'::'+ref.index;if(refs.has(key))state.stars.add(key);
        }
        const remaining=[...state.records];state.order=[];
        for(const ref of Array.isArray(saved.order)?saved.order:[]){const index=remaining.findIndex(r=>ref.path&&Number.isInteger(ref.index)?r.doc.path===ref.path&&r.index===ref.index:ref.id&&r.id===ref.id);if(index>=0)state.order.push(remaining.splice(index,1)[0].key)}
      }catch(_){state.notices.push('辅助排序设置无法解析，已使用日期排序')}
      if (loadToken !== state.loadToken) return;
      state.records.sort((a,b) => C.timestamp(b.raw.update_time || b.raw.create_time) - C.timestamp(a.raw.update_time || a.raw.create_time) || a.key.localeCompare(b.key));
      $('loader').hidden = true; $('app').hidden = false; $('search').value = '';
      state.source=origin||await IO.readonly([...state.entries.values()]);
      if(journal){const file=controlEntry('.viewer-state/viewer-history.json');try{const text=file?await blobText(file.blob):null;if(text!==null)state.inputTexts.set(file.path,text);const stored=await historyStore.open(state.entries,file);journal.open(state.records,orderedRecords().map(r=>r.key),stored,{sort:state.sort});historyStore.align(journal.data,journal.dirty);if(state.editMode&&journal.needsClearConfirmation){const clear=confirm(I.t('旧资料已关闭记录但仍保留历史。确认将清空历史；取消则启用记录并保留历史。'));journal.setEnabled(!clear,backupSnapshot())}}catch(error){journal.open(state.records,orderedRecords().map(r=>r.key),null,{sort:state.sort});historyStore.align(journal.data,true);state.journalProblem=error.message;state.notices.push('历史文件无法解析，聊天原文仍可查看。')}}
      state.savedFileEdits=fileEditState();markModeSaved();state.savedSign=signature();state.fileHandle=null;audit.reset();updateSourceInfo();
      notify('已加载 ' + state.records.length + ' 个会话；默认显示当前分支');
      await renderList(); await fromHash();
    } catch (error) { $('loader').hidden = false; $('app').hidden = true; notify(error.message, true); }
    finally { setBusy(false); }
  }
  function directoryInputEntries(fileList){
    return Array.from(fileList).map(file => {
      const relative = file.webkitRelativePath || file.name, parts = relative.split('/');
      return { path:parts.length > 1 ? parts.slice(1).join('/') : relative, blob:file };
    }).filter(entry=>!IO.hidden(entry.path));
  }
  async function selectedFiles(fileList) {
    if(state.busy)return;
    const entries=directoryInputEntries(fileList);
    try{const name=fileList[0]?.webkitRelativePath?.split('/')[0]||'';await loadEntries(entries,null,await IO.readonly(entries,name))}catch(error){notify('打开目录失败：'+error.message,true)}
  }
  function openImport(){
    if(editBlocked()||state.busy||!state.docs.length)return;
    flushEditor();$('import-dialog').showModal();
  }
  async function chooseImport(kind){
    if(editBlocked()||state.busy||!state.docs.length)return;
    $('import-dialog').close();
    if(kind==='zip'&&typeof window.showOpenFilePicker!=='function'){$('import-zip-input').click();return}
    if(kind==='directory'&&typeof window.showDirectoryPicker!=='function'){$('import-folder-input').click();return}
    return runImport(async()=>{
      if(kind==='directory')return (await IO.directory(await window.showDirectoryPicker({mode:'read'}))).entries;
      const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]});
      return (await IO.zip(await handle.getFile(),null,zipProgress)).entries;
    });
  }
  const fileIds=raw=>[...raw.matchAll(/(?:^|[^\w])(file[-_][A-Za-z0-9]{8,})(?=[^A-Za-z0-9]|$)/g)].map(m=>m[1]);
  const rawIdentity=raw=>raw.replace(/"(?:\\[\s\S]|[^"\\])*"|\s+/g,token=>token[0]==='"'?token:'');
  async function runImport(readEntries){
    if(editBlocked()||state.busy||!state.docs.length)return false;
    flushEditor();setBusy(true);zipProgress('增量导入',null);
    try{
      const incoming=new Map();
      for(const e of await readEntries()){
        if(IO.hidden(e.path)||metadataPath(e.path)||legacyControls.includes(e.path))continue;
        if(!C.validPath(e.path)||incoming.has(e.path))throw new Error(I.t('文件路径无效')+' · '+e.path);
        incoming.set(e.path,e);
      }
      const files=[...incoming.values()].filter(e=>C.conversationFile(e.path.split('/').at(-1))).sort((a,b)=>a.path.localeCompare(b.path));
      if(!files.length)throw new Error(I.t('目录中没有 conversations.json 或 conversations-*.json'));
      const texts=await Promise.all(files.map(e=>blobText(e.blob))),parsed=await parseOffThread(texts),currentRows=new Map(),knownRows=new Map();
      const conversationId=row=>typeof (row.conversation_id||row.id)==='string'?row.conversation_id||row.id:'';
      for(const r of activeRecords()){
        if(!currentRows.has(r.id))currentRows.set(r.id,[]);
        currentRows.get(r.id).push(r);
      }
      const selected=[];let duplicates=0;
      for(let f=0;f<files.length;f++){
        const doc=C.document(texts[f],parsed[f]),spans=C.spans(doc.text,new Set(doc.data.map((_,i)=>C.key([i]))));
        for(const [i,row]of doc.data.entries()){
          if(!C.object(row)||!C.object(row.mapping))continue;
          const id=conversationId(row),raw=doc.text.slice(...spans.get(C.key([i]))),identity=rawIdentity(raw);
          if(!knownRows.has(id))knownRows.set(id,new Set((currentRows.get(id)||[]).map(r=>rawIdentity(journal.rowRaw(r)))));
          const known=knownRows.get(id);
          if(known.has(identity)){duplicates++;continue}
          known.add(identity);selected.push(raw);
        }
        await yieldUI();
      }
      if(!selected.length){notify(duplicates?'没有新的聊天可以导入。':'没有找到可导入的聊天。');return false}
      const raw='[\n'+selected.join(',\n')+'\n]',doc=C.document(raw),occupied=new Set([...state.entries.keys(),...state.addedEntries.keys(),...state.docs.map(d=>d.path)].map(path=>path.toLowerCase()));
      let suffix=1;while(occupied.has('conversations-import-'+suffix+'.json')||[...occupied].some(path=>path.startsWith('assets-import-'+suffix+'/')))suffix++;
      doc.path='conversations-import-'+suffix+'.json';
      const imported=doc.data.map((row,index)=>({raw:row,doc,index,id:conversationId(row),key:doc.path+'::'+index}));
      const sourceResources=new Map(),newResources=new Map(),addedEntries=new Map(),aliases=[];
      await indexResources(incoming,sourceResources);
      const wanted=new Set(fileIds(raw));
      for(const id of wanted){
        const candidate=sourceResources.get(id);if(!candidate)continue;
        const prior=state.resources.get(id);
        if(prior){
          if(await IO.digest(prior.blob)!==await IO.digest(candidate.blob))throw new Error(I.t('同一附件编号的内容不同，导入已停止。')+' '+id);
          continue;
        }
        const basename=candidate.path.split('/').at(-1),path='assets-import-'+suffix+'/'+basename,entry={...candidate,path};
        if(addedEntries.has(path))throw new Error(I.t('文件路径无效')+' · '+path);
        addedEntries.set(path,entry);newResources.set(id,entry);
        if(candidate.name||candidate.mime)aliases.push({file_id:id,file_name:candidate.name,mime_type:candidate.mime});
      }
      if(aliases.length){
        const path='assets-import-'+suffix+'/library_files.json';
        addedEntries.set(path,{path,blob:new Blob([JSON.stringify(aliases)],{type:'application/json'})});
      }
      // The archive, attachment conflicts, and exact source JSON were checked
      // before adding any records to the live draft.
      state.docs.push(doc);state.importDocs.add(doc.path);for(const row of imported)state.records.push(row);
      for(const [path,entry]of addedEntries)state.addedEntries.set(path,entry);
      for(const [id,entry]of newResources)state.resources.set(id,entry);
      for(const r of imported)journal?.recordRaw(r,null,journal.rowRaw(r));
      state.undo.push(audit.track({kind:'import',keys:imported.map(r=>r.key)}));state.redo=[];state.search.query=null;
      state.current??=imported[0].key;await renderList();await renderCurrent(true);
      notify(I.t('已导入到当前草稿')+' · '+imported.length+(duplicates?' · '+I.t('跳过重复聊天')+' '+duplicates:''));
      return true;
    }catch(error){if(error.name!=='AbortError')notify(I.t('导入失败：')+' '+error.message,true);return false}
    finally{setBusy(false)}
  }
  let backupUid=null;
  function orderState(){return {order:orderedRecords(false).map(r=>r.historyUid||r.key),sort:state.sort}}
  function backupSnapshot(){return journal.capture(activeRecords(),orderedRecords(false).map(r=>r.key),{sort:state.sort})}
  function updateBackupControls(){
    if(!journal)return;const enabled=state.editMode&&journal.data.enabled!==false;
    $('backup-toggle').setAttribute('aria-pressed',String(enabled));for(const attr of ['title','aria-label'])if(I.setAttribute)I.setAttribute($('backup-toggle'),attr,enabled?'关闭增量备份':'启用增量备份');$('backup-enabled').checked=enabled;enableControls($('backup-enabled'),!state.editMode||state.busy||!state.docs.length,'启用增量备份');for(const [id,label]of [['backup-clean-age','删除较早备份'],['backup-clean-category','删除此类别'],['backup-clean-all','删除全部增量备份'],['backup-manage','管理增量备份…'],['backup-deleted','恢复已删除会话…'],['backup-order','恢复会话顺序…']])enableControls($(id),!state.editMode||state.busy||state.downloadPending||!state.docs.length,label);I.setAttribute($('backup-enabled-label'),'title',state.editMode?'启用增量备份':modeHint);
    enableControls($('backup-toggle'),!state.editMode||!state.docs.length||state.busy,enabled?'关闭增量备份':'启用增量备份');if($('backup-dialog').open)renderBackups();
  }
  function canChangeBackups(){if(!state.editMode||state.modeChanging||state.busy)return false;if(state.downloadPending){notify('请先确认下载副本已保存，再更改备份设置');return false}return true}
  async function showBackups(category='all',uid=null){
    if(!journal||!state.editMode||!state.docs.length)return;backupUid=uid;$('backup-category').value=category;closeMenus();renderBackups();if(!$('backup-dialog').open)$('backup-dialog').showModal();scrollBackupPosition();  }
  function scrollBackupPosition(uid=backupUid,kind=null){setTimeout(()=>{if(!$('backup-dialog').open)return;const category=$('backup-category').value,marker=[...$('backup-list').querySelectorAll('.backup-position')].find(el=>uid?el.dataset.uid===uid:kind==='order'||category==='order'?el.dataset.kind==='order':true);marker?.scrollIntoView?.({block:'nearest'})},0)}
  const backupClip=(value,limit=74)=>{const s=String(value??'').replace(/\s+/g,' ').trim();return s.length>limit?s.slice(0,limit)+'…':s||'∅'};
  function backupField(path,record){
    if(path[0]==='title')return I.t('标题');
    if(path[0]==='mapping'){
      const node=record?.mapping?.[path[1]],message=node?.message,ids=Object.keys(record?.mapping||{}).filter(id=>record.mapping[id]?.message),role=message?.author?.role;
      return I.t(({user:'用户',assistant:'助手',tool:'工具',system:'系统',developer:'系统'})[role]||'编辑消息')+(ids.includes(path[1])?' #'+(ids.indexOf(path[1])+1):'')+' · '+I.t('正文')+(typeof path.at(-1)==='number'?' '+(path.at(-1)+1):'');
    }
    return path.length?path.join(' / '):I.t('结构变化');
  }
  function backupName(uid){return state.records.find(r=>r.historyUid===uid)?.raw.title||journal.data.records[uid]?.title||uid}
  function backupShort(kind,uid,version){
    const meta=journal.data.records[uid],v=kind==='order'?journal.data.orders.find(v=>v.id===version):meta?.versions?.find(v=>v.id===(version||meta.deleted?.version));if(!v)return '';
    if(kind==='order'){const ops=v.delta.ops||[];if(!ops.length)return I.t('会话顺序');return I.t('会话顺序')+' · '+ops.length+' '+I.t('项变更')+' · '+ops.slice(0,2).map(p=>backupClip(backupName(p.uid),30)).join(' / ')}
    const ops=v.delta.ops?.filter(p=>p.op==='text')||v.delta.fields||[],first=ops[0],r=state.records.find(r=>r.historyUid===uid);
    if(first){const h=(first.edits||first.hunks||[first])[0]||{};const decode=s=>{try{return JSON.parse('"'+s+'"')}catch(_){return s}};
      return backupField(first.path||[],r?.raw)+' · '+backupClip(decode(h.insert||''),48)+' → '+backupClip(decode(h.remove||''),48)+(ops.length>1?' · +'+(ops.length-1):'');
    }
    return I.t(v.kind==='delete'?'删除前':v.kind==='insert'?'恢复前（不存在）':'结构变化')+' · '+backupClip(meta?.title||meta?.deleted?.title||'');
  }
  function backupSnapshotView(parent,raw){
    if(raw===null){parent.append(uiText('p','会话不存在'));return}
    const record=JSON.parse(raw);parent.append(text('h4',record.title||''));
    for(const node of Object.values(C.nodeMap(record))){const m=node?.message;if(!m)continue;const role=C.classification(m).role;
      parent.append(uiText('strong',({user:'用户',assistant:'助手',tool:'工具',system:'系统',developer:'系统'})[role]||'编辑消息'),text('pre',C.blocks(m).map(b=>b.text||b.name||b.id||'').join('\n'),'backup-value'));
    }
    const original=text('details','','backup-original');original.append(uiText('summary','原始数据'));original.addEventListener('toggle',()=>{if(original.open&&!original.dataset.loaded){original.dataset.loaded='1';original.append(text('pre',raw,'backup-value'))}});parent.append(original);
  }
  function backupPreview(parent,kind,uid,version){
    parent.append(uiText('p','左侧为可恢复的历史内容，右侧为其后一次保留的保存状态。','muted'));
    const pair=kind==='order'?journal.inspectOrder(version):journal.inspect(uid,version);
    function columns(a,b,render){const grid=text('div','','backup-diff-columns');for(const [label,value]of [['此历史版本',a],['后续保存状态',b]]){const cell=text('section','');cell.append(uiText('strong',label));render(cell,value);grid.append(cell)}parent.append(grid)}
    if(kind==='order'){
      columns(pair.before,pair.after,(cell,value)=>{const modes={manual:'手动顺序',title:'标题',updated:'最近更新',created:'最近创建',oldest:'最早创建'};cell.append(text('p',I.t(modes[value.sort]||value.sort)));const ol=text('ol','');for(const id of value.order)ol.append(text('li',backupName(id)));cell.append(ol)});return;
    }
    if(pair.before===null||pair.after===null)columns(pair.before,pair.after,backupSnapshotView);
    else{
      const before=JSON.parse(pair.before),after=JSON.parse(pair.after);let changes=0;
      function walk(a,b,path){
        if(a===b)return;
        if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
          for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],[...path,Array.isArray(a)?Number(key):key]);return;
        }
        changes++;parent.append(text('h4',backupField(path,before||after)));
        const value=v=>v===undefined?I.t('不存在'):typeof v==='string'?v:JSON.stringify(v,null,2);
        let focus=null;
        if(typeof a==='string'&&typeof b==='string'&&Math.max(a.length,b.length)>600){
          let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
          const excerpt=s=>{const from=Math.max(0,start-60),end=Math.min(s.length,start+180);return (from?'…':'')+s.slice(from,end)+(end<s.length?'…':'')};focus=[excerpt(a),excerpt(b)];
        }
        columns(a,b,(cell,v)=>{if(focus)cell.append(uiText('small','变更片段'),text('div',focus[v===a?0:1],'backup-change-focus'));cell.append(text('pre',value(v),'backup-value'))});
      }
      walk(before,after,[]);if(!changes&&pair.before!==pair.after){parent.append(uiText('h4','原始数据'));columns(pair.before,pair.after,(cell,v)=>cell.append(text('pre',v,'backup-value')))}
    }
    const full=text('details','','backup-full');full.append(uiText('summary','完整历史内容'));full.addEventListener('toggle',()=>{if(full.open&&!full.dataset.loaded){full.dataset.loaded='1';backupSnapshotView(full,pair.before)}});parent.append(full);
  }
  function renderBackups(){
    const list=$('backup-list'),category=$('backup-category').value,expanded=new Set([...list.querySelectorAll('details[data-preview]')].filter(d=>d.open).map(d=>d.dataset.preview));list.replaceChildren();let count=0;
    if(state.journalProblem){list.append(text('p',I.t('历史文件无法解析，聊天原文仍可查看。'),'error'),button('导出历史文件',async()=>download(await C.zip([...state.entries.values()].filter(e=>e.path==='.viewer-state/viewer-history.json'||e.path==='viewer-history.json'||e.path==='.viewer-backups/viewer-history.json'||ViewerJournalStore.managed(e.path))),'viewer-history-invalid.zip')),button('重置不可用历史',()=>{if(!canChangeBackups()||!confirm(I.t('丢弃不可用历史？聊天原文不会删除。')))return;return runBackupMaintenance(()=>{journal.clearAll(null,{preservePending:true});journal.setEnabled(true);state.journalProblem=null},true)}));return}
    function trash(action){const b=button('',action,'danger icon-button');b.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';b.title=I.t('删除');b.setAttribute('aria-label',I.t('删除'));return b}
    function row(label,time,kind,uid,version,conflict=false,owner=list,here=false){
      const box=text('div','','backup-item'),caption=text('div','','backup-label');box.dataset.version=version||'';box.dataset.uid=uid||'';if(here)box.setAttribute('aria-current','step');caption.append(text('span',label),text('small',new Date(time).toLocaleString(I.locale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3})));
      const restore=button('恢复',()=>restoreBackup(kind,uid,version));restore.disabled=conflict||state.busy;box.append(caption,restore,trash(()=>deleteBackup(kind,uid,version)));owner.append(box);count++;
      const excerpt=text('div',backupShort(kind,uid,version),'backup-excerpt');caption.append(excerpt);
      const details=text('details','','backup-details'),key=JSON.stringify([kind,uid,version]);details.dataset.preview=key;details.append(uiText('summary','查看详情'));
      const populate=()=>{if(!details.open||details.dataset.loaded)return;details.dataset.loaded='1';const content=text('div','','backup-preview');try{if(conflict)throw Error();backupPreview(content,kind,uid,version)}catch(_){content.replaceChildren(uiText('p','无法预览此版本','error'))}details.append(content)};
      details.addEventListener('toggle',populate);box.append(details);if(expanded.has(key)){details.open=true;populate()}
    }
    function marker(owner,pos,uid,total,kind='edit'){
      const box=text('div','','backup-position');box.dataset.uid=uid||'';box.dataset.kind=kind;box.dataset.location=pos.location;box.dataset.version=pos.version||'';box.setAttribute('role','status');
      const location=pos.index>=0?I.t('历史版本')+' #'+(pos.index+1):I.t('最新保存版本')+' #'+(total+1),label=text('strong',I.t('当前位置')+(pos.location==='unavailable'?'':' · '+location)),detail=text('span','','backup-position-detail');
      const description=pos.location==='unavailable'?'该历史无法与当前资料对应':pos.location==='history'?'与此历史版本一致':pos.index>=0?'基于此历史版本的修改':pos.changed?'基于最新保存版本的修改':'最新保存版本';
      detail.textContent=I.t(description)+' · '+I.t(pos.changed?'未保存':'与磁盘一致')+(pos.absent?' · '+I.t('已删除会话'):'');box.append(label,detail);owner.append(box);
    }
    const active=new Map(activeRecords().map(r=>[r.historyUid,r]));
    for(const [uid,meta]of Object.entries(journal.data.records)){
      if(backupUid&&backupUid!==uid)continue;
      const content=(category==='all'||category==='edit')&&meta.versions?.length,deleted=(category==='all'||category==='deleted')&&meta.deleted;if(!content&&!deleted)continue;
      const group=text('section','','backup-timeline');group.dataset.uid=uid;group.append(text('h3',active.get(uid)?.raw.title||meta.title||meta.deleted?.title||uid));list.append(group);
      const pos=journal.position(uid,active.get(uid)||null),versions=meta.versions||[];let placed=false;
      if(!content||pos.index<0){marker(group,pos,uid,versions.length);placed=true}
      if(content)for(const [index,v]of [...versions.entries()].reverse()){
        if(pos.index===index){marker(group,pos,uid,versions.length);placed=true}
        row(I.t('历史版本')+' #'+(index+1)+' · '+I.t(v.kind==='delete'?'删除前':v.kind==='insert'?'恢复前（不存在）':v.delta.ops?.some(p=>p.path?.[0]==='title')||v.delta.fields?.some(p=>p.path[0]==='title')?'标题':'编辑消息'),v.time,'edit',uid,meta.conflict?null:v.id,meta.conflict,group,pos.location==='history'&&pos.version===v.id);
      }
      if(!placed)marker(group,pos,uid,versions.length);
      if(deleted)row(meta.deleted.title+' · '+I.t('已删除会话'),meta.deleted.time,'deleted',uid,null,false,group);
    }
    if(!backupUid&&(category==='all'||category==='order')&&journal.data.orders.length){
      const group=text('section','','backup-timeline');group.append(text('h3',I.t('会话顺序')));list.append(group);const pos=journal.orderPosition(orderState());if(pos.index<0)marker(group,pos,null,journal.data.orders.length,'order');
      for(const [index,v]of [...journal.data.orders.entries()].reverse()){if(pos.index===index)marker(group,pos,null,journal.data.orders.length,'order');row(I.t('历史版本')+' #'+(index+1),v.time,'order',null,v.id,Boolean(journal.data.orderConflict),group,pos.location==='history'&&pos.version===v.id)}
    }
    $('backup-summary').textContent=(backupUid?(journal.data.records[backupUid]?.title||'')+' · ':'')+count+' · '+[...state.entries.values()].filter(e=>e.path.startsWith('.viewer-backups/')||e.path==='viewer-history.json').reduce((n,e)=>n+e.blob.size,0)+' B'+' · '+I.t(journal.maintenanceDirty?'备份更改尚未写入':journal.dirty?'有待保存的聊天修改':'备份已写入')+(state.backupCleanupWarning?' · '+I.t('空目录未能移除'):'');
    if(!count)list.append(text('p',I.t('没有备份记录'),'muted'));
  }
  function workspaceState(){return {docs:[...state.docs],records:[...state.records],deleted:new Set(state.deleted),order:[...state.order],sort:state.sort,current:state.current,revision:state.structuralRevision||0,orderModified:state.orderModified}}
  function applyWorkspace(saved){state.docs=[...saved.docs];state.records=[...saved.records];state.deleted=new Set(saved.deleted);state.order=[...saved.order];state.sort=saved.sort;state.current=saved.current;state.structuralRevision=saved.revision;state.orderModified=saved.orderModified;audit?.rebind?.()}
  function replaceRecordFromHistory(uid,raw){
    const meta=journal.data.records[uid],existing=state.records.find(r=>r.historyUid===uid&&!state.deleted.has(r.key)),path=existing?.doc.path||meta.deleted?.path||meta.path,oldDoc=state.docs.find(d=>d.path===path);
    if(!oldDoc)throw new Error('原聊天分片不存在，无法恢复到该位置');
    const beforeRaw=existing?journal.rowRaw(existing):null;
    const before=workspaceState(),text=C.serialize(oldDoc),spans=C.spans(text,new Set(oldDoc.data.map((_,i)=>C.key([i])))),removed=new Set(state.records.filter(r=>r.doc===oldDoc&&state.deleted.has(r.key)).map(r=>r.index));
    const items=oldDoc.data.map((_,i)=>({raw:text.slice(...spans.get(C.key([i]))),old:state.records.find(r=>r.doc===oldDoc&&r.index===i)})).filter((_,i)=>!removed.has(i));
    function neighbor(start,direction,position){const seen=new Set();let uid=start;while(uid&&!seen.has(uid)){seen.add(uid);const found=position(uid);if(found>=0)return direction==='previous'||direction==='orderPrevious'?found+1:found;uid=journal.data.records[uid]?.deleted?.[direction]}return null}
    let at=existing?items.findIndex(x=>x.old===existing):(neighbor(meta.deleted?.next,'next',uid=>items.findIndex(x=>x.old?.historyUid===uid))??neighbor(meta.deleted?.previous,'previous',uid=>items.findIndex(x=>x.old?.historyUid===uid))??Math.min(meta.deleted?.index??items.length,items.length));const ghost=state.records.find(r=>r.historyUid===uid);
    const key=existing?.key||ghost?.key||path+'::restored-'+uid;if(existing)items[at]={raw,old:existing};else items.splice(at,0,{raw,old:{key,historyUid:uid}});
    const doc=C.document('['+items.map(x=>x.raw).join(',\n')+']');doc.path=path;
    const rebuilt=items.flatMap((item,index)=>{const value=doc.data[index];if(!C.object(value)||!C.object(value.mapping))return [];return [{raw:value,doc,index,id:typeof(value.conversation_id||value.id)==='string'?(value.conversation_id||value.id):'',key:item.old?.key||path+'::'+index,historyUid:item.old?.historyUid}]});
    state.docs=state.docs.map(d=>d===oldDoc?doc:d);state.records=[...state.records.filter(r=>r.doc!==oldDoc&&r.historyUid!==uid),...rebuilt];state.deleted.delete(key);if(!state.order.includes(key)){const position=uid=>state.order.findIndex(k=>state.records.find(r=>r.key===k)?.historyUid===uid),place=neighbor(meta.deleted?.orderNext,'orderNext',position)??neighbor(meta.deleted?.orderPrevious,'orderPrevious',position)??Math.min(meta.deleted?.orderIndex??at,state.order.length);state.order.splice(place,0,key);}state.current=key;state.structuralRevision=(state.structuralRevision||0)+1;
    audit.rebind?.();const after=workspaceState(),tx={kind:'workspace',before,after,target:key};state.undo.push(audit.track(tx));state.redo=[];journal.recordRaw(state.records.find(r=>r.key===key),beforeRaw,raw);
  }
  async function restoreBackup(kind,uid,version){
    if(!canChangeBackups())return;
    try{
      const restoredVersion=version||(uid?journal.data.records[uid]?.deleted?.version:null);setBusy(true);zipProgress('恢复历史',null);await yieldUI();
      if(kind==='order'){
        const beforeState=orderState(),restored=journal.orderStateTarget?.(version),wanted=restored?.order||journal.orderTarget(version),keys=wanted.map(id=>activeRecords().find(r=>r.historyUid===id)?.key).filter(Boolean);for(const r of activeRecords())if(!keys.includes(r.key))keys.push(r.key);
        const tx={kind:'order',before:[...state.order],after:keys,beforeSort:state.sort,afterSort:restored?.sort||'manual',wasModified:state.orderModified,target:keys[0]};state.order=keys;state.sort=tx.afterSort;$('sort-order').value=state.sort;state.orderModified=true;journal.recordOrder(beforeState,orderState());state.undo.push(audit.track(tx));state.redo=[];
      }else{
        const raw=journal.target(uid,version),record=activeRecords().find(r=>r.historyUid===uid),target=raw===null?null:JSON.parse(raw),edits=[];
        if(raw===null){if(record)deleteRecords([record.key],true);journal.markRestored(uid,restoredVersion);updateChanges();await renderList();await renderCurrent();renderBackups();scrollBackupPosition(uid,kind==='order'?'order':null);notify('已恢复到草稿，点击保存后写入资料');return}
        function walk(a,b,path){if(typeof a==='string'&&typeof b==='string'){if(a!==b)edits.push({doc:record.doc,path:[record.index,...path],value:b});return true}if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>walk(v,b[i],[...path,i]));if(C.object(a)&&C.object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&walk(a[k],b[k],[...path,k]))}return false}
        const fieldsOnly=record&&walk(record.raw,target,[]),exact=fieldsOnly&&C.patch(journal.rowRaw(record),edits.map(e=>({path:e.path.slice(1),value:e.value})))===raw;if(exact){state.current=record.key;commit(edits,true)}else replaceRecordFromHistory(uid,raw);
      }
      if(kind==='order')journal.markOrderRestored(version);else journal.markRestored(uid,restoredVersion);
      state.cache.clear();state.search.query=null;updateChanges();await renderList();await renderCurrent();renderBackups();scrollBackupPosition(uid,kind==='order'?'order':null);notify('已恢复到草稿，点击保存后写入资料');
    }catch(error){notify('恢复失败：'+error.message,true)}finally{setBusy(false)}
  }
  function deleteBackup(kind,uid,version){
    if(!canChangeBackups()||!confirm(I.t('删除这个备份版本？此操作不能撤销。')))return Promise.resolve(false);
    return runBackupMaintenance(()=>journal.purge(v=>v.kind===kind&&(!uid||v.uid===uid)&&(!version||v.id===version)));
  }
  function cleanupBackups(mode){
    if(!canChangeBackups()||!confirm(I.t(mode==='all'?'删除所有会话和顺序的全部增量备份？':'清理选定范围的备份？此操作不能撤销。')))return Promise.resolve(false);
    const category=$('backup-category').value,days=Number($('backup-days').value);if(mode==='age'&&(!Number.isFinite(days)||days<0)){notify('请输入有效天数',true);return Promise.resolve(false)}
    return runBackupMaintenance(()=>{if(mode==='all'){journal.clearAll(null,{preservePending:true});state.journalProblem=null}else journal.purge(v=>(category==='all'||v.kind===category)&&(!backupUid||v.uid===backupUid)&&(mode!=='age'||new Date(v.time).getTime()<Date.now()-days*86400000))},mode==='all');
  }
  function toggleBackups(value){
    if(!journal||!canChangeBackups())return Promise.resolve(false);if(!value&&journal.data.enabled&&!confirm(I.t('关闭增量备份会清空全部历史文件并立即写入。是否继续？'))){updateBackupControls();return Promise.resolve(false)}
    return runBackupMaintenance(()=>{if(!value){journal.clearAll(backupSnapshot());journal.setEnabled(false);state.journalProblem=null}else journal.setEnabled(true,backupSnapshot())},!value);
  }
  $('backup-toggle').addEventListener('click',()=>toggleBackups(!journal.data.enabled));$('backup-enabled').addEventListener('change',()=>toggleBackups($('backup-enabled').checked));
  for(const [id,category]of [['backup-manage','all'],['backup-deleted','deleted'],['backup-order','order']])$(id).addEventListener('click',()=>showBackups(category));
  $('backup-close').addEventListener('click',()=>$('backup-dialog').close());$('backup-category').addEventListener('change',()=>{if($('backup-category').value!=='edit')backupUid=null;renderBackups()});
  $('backup-clean-age').addEventListener('click',()=>cleanupBackups('age'));$('backup-clean-category').addEventListener('click',()=>cleanupBackups('category'));$('backup-clean-all').addEventListener('click',()=>cleanupBackups('all'));

  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function flushEditor(){if($('editor').open&&$('save-edit').onclick)$('save-edit').onclick()}
  function fileEditState(){return new Map(state.docs.map(doc=>[doc,{doc,edits:[...doc.changes.values()].map(e=>({path:[...e.path],value:e.value})),removed:new Set(state.records.filter(r=>r.doc===doc&&state.deleted.has(r.key)).map(r=>r.index))}]))}
  function sameEdits(before,after){return before&&before.edits.length===after.edits.length&&before.removed.size===after.removed.size&&[...after.removed].every(i=>before.removed.has(i))&&after.edits.every(e=>before.edits.some(old=>C.key(old.path)===C.key(e.path)&&old.value===e.value))}
  function rebuildSavedFile(saved){let raw=C.patch(saved.doc.text,saved.edits,journal?.documentIndex?.(saved.doc));if(saved.removed.size){const spans=C.spans(raw,new Set(saved.doc.data.map((_,i)=>C.key([i]))));raw='[\n'+saved.doc.data.map((_,i)=>i).filter(i=>!saved.removed.has(i)).map(i=>raw.slice(...spans.get(C.key([i])))).join(',\n')+'\n]'}return new Blob([raw],{type:'application/json'})}
  async function migrateControls(original,entries,removed,clear=false){
    for(const path of legacyControls)if(original.has(path)){const next=statePath(path),existing=original.get(next);if(existing&&!(clear&&next===ViewerJournalStore.path)&&await blobText(existing.blob)!==await blobText(original.get(path).blob))throw new Error('请先在备份管理中处理不可用历史，或导出资料副本');if(next.endsWith('/viewer-settings.json')&&!entries.has(next))entries.set(next,{path:next,blob:new Blob([await blobText(original.get(path).blob)],{type:'application/json'})});entries.delete(path);removed.add(path)}
  }
  async function commitBackupMaintenance(){
    let source=state.source;
    if(!source||source.kind==='embedded'||source.kind==='directory-readonly'&&typeof window.showDirectoryPicker!=='function'||source.kind==='zip'&&!source.handle&&typeof window.showOpenFilePicker!=='function')return {deferred:true};
    if(source.kind==='directory-readonly'){notify('请选择最初打开的目录，以授权写回');source=await IO.bindDirectory(source,await window.showDirectoryPicker({mode:'readwrite'}))}
    else if(source.kind==='zip'&&!source.handle){const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]});await IO.permission(handle);source=await IO.bindZip(source,handle)}
    const plan=historyStore.prepare(journal.data),original=new Map(state.entries),entries=new Map(original),removed=new Set(plan.removedPaths),rollback=new Map();
    for(const e of plan.entries)entries.set(e.path,e);for(const path of removed)entries.delete(path);await migrateControls(original,entries,removed,state.allowLegacyHistoryClear);
    if(plan.clearBackupFolder)for(const path of [...entries.keys()])if(path.startsWith('.viewer-backups/')){entries.delete(path);removed.add(path)}
    const settingsPath='.viewer-state/viewer-settings.json';if(!entries.has(settingsPath))entries.set(settingsPath,{path:settingsPath,blob:new Blob([JSON.stringify({version:1,editMode:true,sort:'updated',order:[]})],{type:'application/json'})});
    const output=[...entries.values()];output.removedPaths=removed;output.clearBackupFolder=plan.clearBackupFolder;output.changedPaths=new Set(output.filter(e=>original.get(e.path)?.blob!==e.blob).map(e=>e.path));
    for(const path of new Set([...removed,...output.changedPaths]))if(original.has(path)){let before=state.inputTexts.get(path);if(before===undefined)before=await blobText(original.get(path).blob);rollback.set(path,()=>new Blob([before],{type:original.get(path).blob.type||'application/json'}))}
    zipProgress('正在写入备份更改',null);let cleanupFailures=[];
    if(source.kind==='zip')state.source=await IO.saveZip(source,output,source.handle,false,zipProgress);
    else{const result=await IO.saveDirectory(source,output,{paths:output.changedPaths,rollback,removePaths:removed,clearBackupFolder:plan.clearBackupFolder});state.source=result.source;cleanupFailures=result.cleanupFailures||[]}
    state.entries=entries;for(const path of removed)state.inputTexts.delete(path);state.inputTexts.set(ViewerJournalStore.path,await blobText(entries.get(ViewerJournalStore.path).blob));historyStore.accept(plan);journal.acceptMaintenance();state.backupCleanupWarning=Boolean(cleanupFailures.length);updateSourceInfo();return {cleanupFailures};
  }
  function runBackupMaintenance(change,clearAll=false){
    if(!canChangeBackups())return Promise.resolve(false);const before=journal.maintenanceCheckpoint(),problem=state.journalProblem,oldAllow=state.allowLegacyHistoryClear;state.allowLegacyHistoryClear=oldAllow||clearAll;setBusy(true);
    const task=(async()=>{try{change();renderBackups();const result=await commitBackupMaintenance();if(result.deferred){notify('当前资料不能直接写回，备份更改尚未写入；请另存为资料。',true);return false}state.allowLegacyHistoryClear=false;notify(result.cleanupFailures.length?'历史文件已删除，但空目录未能移除。':'备份更改已写入，聊天草稿未另行保存。',Boolean(result.cleanupFailures.length));return true}catch(error){journal.restoreMaintenance(before);state.journalProblem=problem;state.allowLegacyHistoryClear=oldAllow;if(error.name!=='AbortError')notify(I.t('备份操作未完成：')+error.message,true);return false}finally{setBusy(false);renderBackups();renderList();updateChanges()}})();state.backupTask=task;return task;
  }
  function cleanControlManifest(raw){
    const value=C.parse(raw),spans=C.spans(raw,null),replacements=[],owned=path=>legacyControls.includes(path)||legacyControls.some(name=>path===statePath(name));
    const replace=(path,value)=>{const [start,end]=spans.get(C.key(path));replacements.push({start,end,value})};
    if(Array.isArray(value.export_files)&&value.export_files.some(item=>owned(item?.path)))replace(['export_files'],'['+value.export_files.map((item,i)=>({item,i})).filter(({item})=>!owned(item?.path)).map(({i})=>raw.slice(...spans.get(C.key(['export_files',i])))).join(',')+']');
    if(C.object(value.logical_files)&&Object.keys(value.logical_files).some(owned))replace(['logical_files'],'{'+Object.keys(value.logical_files).filter(name=>!owned(name)).map(name=>JSON.stringify(name)+':'+raw.slice(...spans.get(C.key(['logical_files',name])))).join(',')+'}');
    for(const edit of replacements.sort((a,b)=>b.start-a.start))raw=raw.slice(0,edit.start)+edit.value+raw.slice(edit.end);return raw;
  }
  function registerImportedFiles(raw,entries,documents){
    if(!entries.length)return raw;
    const manifest=C.parse(raw),spans=C.spans(raw,null),changes=[];
    function append(path,items,length){
      if(!items.length)return;
      const [,end]=spans.get(C.key(path));changes.push({start:end-1,end:end-1,raw:(length?',':'')+items.join(',')});
    }
    if(Array.isArray(manifest.export_files)){
      const seen=new Set(manifest.export_files.map(e=>e?.path));
      append(['export_files'],entries.filter(e=>!seen.has(e.path)).map(e=>JSON.stringify({path:e.path,size_bytes:e.blob.size})),manifest.export_files.length);
    }
    const logical=manifest.logical_files;
    if(C.object(logical)){
      const conversations=entries.filter(e=>C.conversationFile(e.path.split('/').at(-1))).map(e=>e.path);
      const paths=logical['conversations.json']?.files;
      const extra=entries.filter(e=>!conversations.includes(e.path)&&!Object.hasOwn(logical,e.path)).map(e=>JSON.stringify(e.path)+':'+JSON.stringify({files:[e.path],sharded:false}));
      if(Array.isArray(paths)){
        append(['logical_files','conversations.json','files'],conversations.filter(path=>!paths.includes(path)).map(path=>JSON.stringify(path)),paths.length);
        const flag=spans.get(C.key(['logical_files','conversations.json','sharded']));
        if(conversations.length&&flag)changes.push({start:flag[0],end:flag[1],raw:'true'});
      }else if(conversations.length&&!Object.hasOwn(logical,'conversations.json')){
        extra.push('"conversations.json":'+JSON.stringify({files:documents.map(doc=>doc.path),sharded:documents.length>1}));
      }
      append(['logical_files'],extra,Object.keys(logical).length);
    }
    for(const change of changes.sort((a,b)=>b.start-a.start))raw=raw.slice(0,change.start)+change.raw+raw.slice(change.end);
    return raw;
  }
  async function workspaceEntries(){
    // Everything below this checkpoint is derived from the same synchronous snapshot.
    const originalEntries=new Map(state.entries),entries=new Map(originalEntries),files=fileEditState(),rollback=new Map(),removedPaths=new Set(),raws=new Map(),docs=effectiveDocuments();let dataChanged=false;
    const checkpoint={sign:signature(),audit:audit.capture(),revision:state.structuralRevision||0};
    const stagedPaths=new Set(),stagedFolders=new Set();
    for(const r of activeRecords())if(state.importDocs.has(r.doc.path)){
      for(const id of fileIds(journal.rowRaw(r))){
        const path=state.resources.get(id)?.path;if(!state.addedEntries.has(path))continue;
        stagedPaths.add(path);stagedFolders.add(path.split('/')[0]);
      }
    }
    for(const [path,entry]of state.addedEntries)if(!entries.has(path)&&(stagedPaths.has(path)||stagedFolders.has(path.split('/')[0])&&path.endsWith('/library_files.json')))entries.set(path,entry);
    for(const doc of docs){const next=files.get(doc),saved=state.savedFileEdits?.get(doc);if(entries.has(doc.path)&&sameEdits(saved,next))continue;
      const raw=next.removed.size?'[\n'+doc.data.map((_,i)=>i).filter(i=>!next.removed.has(i)).map(i=>journal?journal.rowRaw({doc,index:i}):E.selectIndices(doc,[i]).slice(1,-1)).join(',\n')+'\n]':journal?journal.serializeDocument(doc):C.serialize(doc);
      raws.set(doc.path,raw);entries.set(doc.path,{path:doc.path,blob:new Blob([raw],{type:'application/json'})});dataChanged=true;
      const previous=[...state.savedFileEdits.values()].find(value=>value.doc.path===doc.path);if(previous)rollback.set(doc.path,()=>rebuildSavedFile(previous));
    }
    const ordered=orderedRecords(false),editMode=state.editMode,starred=new Set(state.stars);
    const sort=state.sort;checkpoint.mode=editMode;checkpoint.stars=JSON.stringify([...starred].sort());
    const refs=new Map(),byDoc=new Map();
    for(const r of state.records){if(!byDoc.has(r.doc))byDoc.set(r.doc,new Map());byDoc.get(r.doc).set(r.index,r)}
    for(const [doc,rows]of byDoc){let index=0;for(let i=0;i<doc.data.length;i++){
      const row=rows.get(i);if(row&&state.deleted.has(row.key))continue;
      if(row)refs.set(row.key,{id:row.id,path:doc.path,index});index++;
    }}
    if(editMode){
      const settings={version:2,editMode:true,sort:state.sort,order:ordered.map(r=>refs.get(r.key)),stars:ordered.filter(r=>starred.has(r.key)).map(r=>refs.get(r.key))};
      entries.set(settingsPath,{path:settingsPath,blob:new Blob([JSON.stringify(settings,null,2)],{type:'application/json'})});
    }
    if(journal){
      if(editMode&&state.journalProblem)throw new Error('请先在备份管理中处理不可用历史，或导出资料副本');
      checkpoint.journal=journal.prepare(backupSnapshot());state.pendingJournal=checkpoint.journal;
      if(editMode){
        checkpoint.history=historyStore.prepare(checkpoint.journal.data);
        for(const e of checkpoint.history.entries)entries.set(e.path,e);
        for(const path of checkpoint.history.removedPaths){removedPaths.add(path);entries.delete(path)}
      }
    }
    if(!editMode)for(const path of entries.keys())if(metadataPath(path)||legacyControls.includes(path)){entries.delete(path);removedPaths.add(path)}
    let combined,frozenRecords;const resources=new Map(state.resources);
    const updateChat=dataChanged||editMode!==state.savedMode||checkpoint.stars!==state.savedStars;
    if(updateChat&&[...entries.keys()].some(path=>path.split('/').pop()==='chat.html')){
      const frozenDocs=new Map();for(const doc of docs){if(!raws.has(doc.path))raws.set(doc.path,journal?journal.serializeDocument(doc):C.serialize(doc));const index=new Map();let n=0;for(let i=0;i<doc.data.length;i++)if(!files.get(doc).removed.has(i))index.set(i,n++);frozenDocs.set(doc,{doc:{path:doc.path,text:raws.get(doc.path),changes:new Map()},index})}
      combined=C.combineSources(docs.map(doc=>raws.get(doc.path)));frozenRecords=ordered.map(r=>({id:r.id,key:r.key,raw:{id:r.raw.id},doc:frozenDocs.get(r.doc).doc,index:frozenDocs.get(r.doc).index.get(r.index)}));
    }
    const newImportFiles=[...entries.values()].filter(e=>!originalEntries.has(e.path)&&(state.importDocs.has(e.path)||stagedPaths.has(e.path)||stagedFolders.has(e.path.split('/')[0])));
    // First await: edits made after this point cannot change checkpoint content.
    if(editMode)await migrateControls(originalEntries,entries,removedPaths,state.allowLegacyHistoryClear);
    if(checkpoint.history?.clearBackupFolder)for(const path of [...entries.keys()])if(path.startsWith('.viewer-backups/')){entries.delete(path);removedPaths.add(path)}
    for(const path of removedPaths)if(!rollback.has(path)&&originalEntries.has(path)){const original=await blobText(originalEntries.get(path).blob);rollback.set(path,()=>new Blob([original],{type:'application/json'}))}
    for(const [path,entry]of entries)if(path.split('/').pop()==='chat.html'&&updateChat){
      const original=await blobText(entry.blob),embedded=/<script\b[^>]*\bid=["']data["'][^>]*>([\s\S]*?)<\/script>/i.exec(original);let portable=false;try{const data=embedded&&C.parse(embedded[1]);portable=data?.version===2&&Array.isArray(data.sources)}catch(_){}
      rollback.set(path,()=>new Blob([original],{type:'text/html'}));const updated=portable?E.html(original,await E.payload(frozenRecords,resources,{editMode,starred,sort})):C.syncChatHTML(original,combined);entries.set(path,{path,blob:new Blob([updated],{type:'text/html'})});
    }
    for(const [path,entry]of entries)if(path==='export_manifest.json'){
      const original=await blobText(entry.blob),cleaned=registerImportedFiles(cleanControlManifest(original),newImportFiles,docs),manifest=C.parse(cleaned),edits=[];rollback.set(path,()=>new Blob([original],{type:'application/json'}));
      for(const [i,item]of (Array.isArray(manifest.export_files)?manifest.export_files:[]).entries())if(C.object(item)&&typeof item.path==='string'&&entries.has(item.path)&&item.path!==path&&C.get(manifest,['export_files',i,'size_bytes'])!==undefined&&item.size_bytes!==entries.get(item.path).blob.size)edits.push({path:['export_files',i,'size_bytes'],value:entries.get(item.path).blob.size});
      const updated=C.patch(cleaned,edits);entries.set(path,{path,blob:new Blob([updated],{type:'application/json'})});
    }
    const output=[...entries.values()];output.changedPaths=new Set(output.filter(e=>originalEntries.get(e.path)?.blob!==e.blob).map(e=>e.path));
    for(const path of output.changedPaths)if(!rollback.has(path)&&originalEntries.has(path)){let original=state.inputTexts.get(path);if(original===undefined)original=await blobText(originalEntries.get(path).blob);rollback.set(path,()=>new Blob([original],{type:originalEntries.get(path).blob.type||'application/octet-stream'}))}
    output.clearMetadata=!editMode;output.rollback=rollback;output.removedPaths=removedPaths;output.clearBackupFolder=Boolean(checkpoint.history?.clearBackupFolder);output.fileState=files;output.checkpoint=checkpoint;return output;
  }
  async function workspaceArchive(){return C.zip(await workspaceEntries(),(n,total)=>notify('正在打包副本：'+n+' / '+total))}
  function updateSourceInfo(){
    $('source-info').textContent=state.source?((state.source.kind==='zip'?'ZIP':state.source.kind==='embedded'?'HTML':I.t('目录'))+' · '+(state.source.name||'')):'';
  }
  async function openDirectory(){
    if(state.busy)return;
    try{if(typeof window.showDirectoryPicker==='function'){const handle=await window.showDirectoryPicker({mode:'readwrite'}),opened=await IO.directory(handle);await loadEntries(opened.entries,null,opened.source)}else $('folder-input').click()}
    catch(error){if(error.name!=='AbortError')notify('打开失败：'+error.message,true)}
  }
  async function readZIP(blob,handle=null){if(state.busy)throw new Error('正在处理，请等待完成');setBusy(true);try{return await IO.zip(blob,handle,zipProgress)}finally{setBusy(false)}}
  async function openZIP(){
    if(state.busy)return;
    try{if(typeof window.showOpenFilePicker==='function'){const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]}),opened=await readZIP(await handle.getFile(),handle);await loadEntries(opened.entries,null,opened.source)}else $('zip-input').click()}
    catch(error){if(error.name!=='AbortError')notify('打开失败：'+error.message,true)}
  }
  function markModeSaved(checkpoint){
    state.savedMode=checkpoint?.mode??state.editMode;
    state.savedStars=checkpoint?.stars??JSON.stringify([...state.stars].sort());
  }
  async function toggleEditMode(){
    if(!state.docs.length||state.busy||state.modeChanging||state.downloadPending)return false;
    if(!state.editMode){
      state.editMode=true;state.viewSort=null;updateChanges();updateSelection();await renderList();await renderCurrent(true);return true;
    }
    if(!confirm(I.t('关闭编辑模式会保存当前聊天并清除星标、手动排序和增量备份（如已启用）。是否继续？')))return false;
    flushEditor();
    const previous={editMode:state.editMode,viewSort:state.viewSort,stars:state.stars,order:state.order,sort:state.sort,orderModified:state.orderModified,journalProblem:state.journalProblem};
    const backup=journal?.maintenanceCheckpoint();
    state.modeChanging=true;state.editMode=false;state.viewSort=null;state.stars=new Set();state.order=[];state.sort='updated';state.orderModified=false;state.journalProblem=null;
    if(journal){journal.clearAll(backupSnapshot());journal.setEnabled(false)}
    let saved=false;
    try{
      const source=state.source,needsCopy=!source||source.kind==='embedded'||source.kind==='directory-readonly'&&typeof window.showDirectoryPicker!=='function'||source.kind==='zip'&&!source.handle&&typeof window.showOpenFilePicker!=='function';
      saved=await (needsCopy?saveAsChoice('zip'):saveWorkspace());
      if(saved){historyStore.reset();state.undo=[];state.redo=[];audit.reset();if(!state.backupCleanupWarning)notify(state.downloadPending?'已生成 ZIP 下载，请确认副本已保存':'编辑模式已关闭，当前聊天已保存。')}
      return saved;
    }finally{
      if(!saved){Object.assign(state,previous);if(backup)journal.restoreMaintenance(backup)}
      state.modeChanging=false;updateChanges();updateSelection();await renderList();await renderCurrent(true);
    }
  }
  async function saveWorkspace(asNew=false){
    if(state.busy)return false;flushEditor();if(!state.docs.length||$('app').hidden)return false;
    if(!asNew&&!state.modeChanging&&state.source&&state.source.kind!=='embedded'&&!state.journalProblem&&!unsaved())return true;
    if(asNew||!state.source||state.source.kind==='embedded')return saveAsChoice(asNew&&state.source?.kind!=='zip'&&state.source?.kind!=='embedded'?'directory':'zip');
    state.saving=true;setBusy(true);zipProgress('准备保存',null);
    try{
      const build=workspaceEntries().then(entries=>({entries}),error=>({error}));let source=state.source;
      // Reacquire the original handle only after the user explicitly requests Save.
      if(source.kind==='directory-readonly'){
        if(typeof window.showDirectoryPicker!=='function')throw new Error('当前浏览器不支持写回目录。请使用 Chrome/Edge，或选择另存为 ZIP');
        notify('请选择最初打开的目录，以授权写回');source=await IO.bindDirectory(source,await window.showDirectoryPicker({mode:'readwrite'}));
      }else if(source.kind==='zip'&&!source.handle){
        if(typeof window.showOpenFilePicker!=='function')throw new Error('当前浏览器不能写回 ZIP，请使用 Chrome/Edge，或选择另存为');
        const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:I.t('原 ZIP'),accept:{'application/zip':['.zip']}}]});await IO.permission(handle);source=await IO.bindZip(source,handle);
      }
      await IO.permission(source.handle);const built=await build;if(built.error)throw built.error;const entries=built.entries;if(source.kind==='zip')zipProgress('整理文件',null);
      if(source.kind==='zip'){state.source=await IO.saveZip(source,entries,source.handle,false,zipProgress);state.backupCleanupWarning=false;notify('已保存到原 ZIP')}
      else{const result=await IO.saveDirectory(source,entries,{paths:entries.changedPaths,rollback:entries.rollback,removePaths:entries.removedPaths,clearBackupFolder:entries.clearBackupFolder,clearMetadata:entries.clearMetadata,progress:zipProgress});state.source=result.source;state.backupCleanupWarning=Boolean(result.cleanupFailures?.length);notify(state.backupCleanupWarning?'历史文件已删除，但空目录未能移除。':'已保存到当前目录',state.backupCleanupWarning)}
      if(journal&&entries.checkpoint.journal)journal.accept(entries.checkpoint.journal);if(entries.checkpoint.history)historyStore.accept(entries.checkpoint.history);state.savedStructuralRevision=entries.checkpoint.revision;
      state.entries=new Map(entries.map(e=>[e.path,e]));state.allowLegacyHistoryClear=false;state.savedFileEdits=entries.fileState;state.inputTexts.clear();if(entries.find(e=>e.path==='.viewer-state/viewer-history.json'))state.inputTexts.set('.viewer-state/viewer-history.json',await blobText(entries.find(e=>e.path==='.viewer-state/viewer-history.json').blob));markModeSaved(entries.checkpoint);state.savedSign=entries.checkpoint.sign;audit.markSaved(entries.checkpoint.audit,state.source.name);state.downloadPending=false;state.lastSaveDownload=false;await renderList();updateSourceInfo();updateChanges();return true;
    }catch(error){if(error.name!=='AbortError')notify('保存失败：'+error.message,true);return false}finally{state.saving=false;setBusy(false)}
  }
  async function saveAsChoice(kind){
    if(state.busy)return;flushEditor();state.saving=true;setBusy(true);zipProgress('准备保存',null);
    try{
      const build=workspaceEntries().then(entries=>({entries}),error=>({error}));
      let target;
      if(kind==='directory'){
        if(typeof window.showDirectoryPicker!=='function')throw new Error('当前浏览器不支持写入目录，请选择另存为 ZIP');
        target=await IO.directory(await window.showDirectoryPicker({mode:'readwrite'}));if(target.entries.length)throw new Error('另存为目录必须为空，请选择或新建一个空目录');
        await IO.permission(target.source.handle);
      }else if(typeof window.showSaveFilePicker==='function'){
        target=await window.showSaveFilePicker({suggestedName:E.filename((state.source?.name||'ChatGPT').replace(/\.zip$/i,''))+I.t('-副本.zip'),types:[{description:'ChatGPT ZIP',accept:{'application/zip':['.zip']}}]});
        if(state.source?.handle?.isSameEntry&&await state.source.handle.isSameEntry(target))throw new Error('另存为请选择不同的 ZIP；覆盖当前 ZIP 请使用保存');
        await IO.permission(target);
      }
      const built=await build;if(built.error)throw built.error;const entries=built.entries;if(kind==='zip')zipProgress('整理文件',null);
      if(kind==='directory'){const result=await IO.saveDirectory(target.source,entries,{clearBackupFolder:entries.clearBackupFolder,clearMetadata:entries.clearMetadata,progress:zipProgress});state.source=result.source;state.lastSaveDownload=false}
      else if(target){state.source=await IO.saveZip(state.source,entries,target,true,zipProgress);state.lastSaveDownload=false}
      else{
        const blob=await IO.zipBlob(state.source,entries,zipProgress);zipProgress('校验保存结果',null);const opened=await IO.zip(blob);state.source=opened.source;download(blob,('ChatGPT'+I.t('-副本.zip')));state.source.name=('ChatGPT'+I.t('-副本.zip'));
        state.lastSaveDownload=true;state.downloadPending=true;state.downloadSign=entries.checkpoint.sign;state.downloadModeCheckpoint=entries.checkpoint;state.downloadAudit=entries.checkpoint.audit;state.downloadJournal=entries.checkpoint.journal;state.downloadHistory=entries.checkpoint.history;state.downloadRevision=entries.checkpoint.revision;state.downloadFiles=entries.fileState;
      }
      state.entries=new Map(entries.map(e=>[e.path,e]));
      if(!state.lastSaveDownload){state.allowLegacyHistoryClear=false;state.savedFileEdits=entries.fileState;state.inputTexts.clear();if(journal&&entries.checkpoint.journal)journal.accept(entries.checkpoint.journal);if(entries.checkpoint.history)historyStore.accept(entries.checkpoint.history);state.savedStructuralRevision=entries.checkpoint.revision;markModeSaved(entries.checkpoint);state.savedSign=entries.checkpoint.sign;audit.markSaved(entries.checkpoint.audit,state.source.name);state.downloadPending=false;await renderList()}
      const closeAfter=state.closeAfterSave;state.closeAfterSave=false;updateSourceInfo();updateChanges();notify(state.lastSaveDownload?'已生成 ZIP 下载，请确认副本已保存':'另存为完成；之后保存将写入这个新位置');
      if(closeAfter){if(state.lastSaveDownload){$('leave-message').textContent='请确认下载完成后再关闭';$('leave-confirm-download').hidden=false}else if(!unsaved()&&!editorChanged()){$('leave-dialog').close();closeWorkspace(true)}else $('leave-message').textContent=I.t('保存期间又有新的修改，请再次保存。')}
          return true;
    }catch(error){if(error.name!=='AbortError')notify('另存为失败：'+error.message,true);return false}finally{state.saving=false;setBusy(false)}
  }
  function exportRecords(){
    const scope=$('export-range').value;
    return orderedRecords().filter(r=>scope==='all'||scope==='current'&&r.key===state.current||scope==='selected'&&state.exportKeys.includes(r.key));
  }
  function openExport(keys,format='html'){
    if(state.busy||!state.records.length)return;
    flushEditor();closeMenus();state.exportKeys=(keys===undefined?[...state.selected]:keys).filter(key=>!state.deleted.has(key));
    $('export-format').value=format;
    $('export-range').value=state.exportKeys.length?'selected':current()?'current':'all';
    const rows=exportRecords();state.exportAutoName=E.filename(rows.length===1?title(rows[0]):'聊天记录');$('export-name').value=state.exportAutoName;
    updateExportOptions();$('export-dialog').showModal();
  }
  function exportProgress(){
    let lastYield=Date.now();
    return async(stage,done,total)=>{
      zipProgress(stage,total?done/total*100:null);
      if(Date.now()-lastYield>=35){
        await yieldUI();lastYield=Date.now();
      }
    };
  }
  function updateExportOptions(){
    const format=$('export-format').value,paged=format==='pdf'||format==='print',obsidian=format==='obsidian',bundle=format==='directory'||format==='zip',rows=exportRecords();
    const name=E.filename(rows.length===1?title(rows[0]):'聊天记录');if($('export-name').value===state.exportAutoName)$('export-name').value=name;state.exportAutoName=name;
    $('export-scope').textContent='准备导出 '+rows.length+' 段聊天，包含当前未保存的编辑内容。';
    $('markdown-options').hidden=format!=='markdown'&&!obsidian;$('export-layout-label').hidden=paged||bundle||obsidian;
    $('export-name-label').hidden=paged||!obsidian&&!bundle&&$('export-layout').value==='separate';
    I.setText($('export-name-caption'),format==='directory'?'文件夹名称':'文件名');
    $('export-start').textContent=paged?'继续到页面设置':'开始导出';$('export-start').disabled=!rows.length||state.busy;
    I.setText($('export-hint'),obsidian?'解压 ZIP，在 Obsidian 中将解压目录作为知识库打开，然后打开聊天索引。':format==='directory'?'输入文件夹名称，再选择存放位置。程序会新建子文件夹并导出聊天和附件。':bundle?'仅导出指定范围的完整会话结构和相关媒体，可重新打开；不会切换保存位置或清除未保存状态。':paged?'沿用浏览器分页和打印功能；PDF 请在打印窗口选择“另存为 PDF”。':'使用当前草稿，即使还没保存。分别导出时按聊天标题命名。');
  }
  async function exportSelection(){
    flushEditor();if(state.busy)return;
    const records=exportRecords();if(!records.length)return;
    if(['pdf','print'].includes($('export-format').value)){const pdf=$('export-format').value==='pdf',scope=$('export-range').value,keys=[...state.exportKeys];$('export-dialog').close();openPrint(pdf,keys,scope);return}
    const format=$('export-format').value,combined=$('export-layout').value==='combined',requestedName=$('export-name').value;
    const name=format==='directory'?requestedName:E.filename(requestedName||'聊天记录');
    const report=exportProgress(),onMedia=(done,total)=>report('整理导出附件',done,total);
    const exportSettings={editMode:state.editMode&&(state.savedMode||state.orderModified||state.stars.size>0||state.deleted.size>0||state.docs.some(doc=>doc.changes.size)||effectiveDocuments().some(doc=>state.importDocs.has(doc.path))||state.structuralRevision>0),starred:new Set(state.stars),onMedia};
    const pack=async entries=>{
      zipProgress('打包导出文件',0);await yieldUI();
      return C.zip(entries,(n,t)=>zipProgress('打包导出文件',n/t*100));
    };
    setBusy(true);$('export-start').disabled=$('export-cancel').disabled=true;
    try{
      let handle;
      if(format==='directory'){
        IO.validateExportFolderName(name);
        if(typeof window.showDirectoryPicker!=='function')throw new Error('当前浏览器不支持写入目录，请使用 Chrome/Edge，或导出为 ZIP');
        zipProgress('等待选择导出位置');
        handle=await window.showDirectoryPicker({mode:'readwrite'});
      }else if(format==='zip'&&typeof window.showSaveFilePicker==='function'){
        zipProgress('等待选择导出位置');
        handle=await window.showSaveFilePicker({suggestedName:name+'.zip',types:[{description:'ChatGPT ZIP',accept:{'application/zip':['.zip']}}]});
        if(state.source?.handle?.isSameEntry&&await state.source.handle.isSameEntry(handle))throw new Error('导出请选择新的 ZIP；覆盖源 ZIP 请使用保存');
        if(state.source?.kind==='zip'&&!state.source.handle&&await IO.digest(await handle.getFile())===state.source.zipDigest)throw new Error('导出目标与打开的 ZIP 内容相同，请选择新的 ZIP');
      }
      zipProgress('准备导出');await yieldUI();
      if(format==='directory'||format==='zip'){
        const entries=await E.bundle(records,state.resources,exportShell,exportSettings);
        if(format==='directory')await IO.exportSubdirectory(handle,name,entries,zipProgress);
        else{const blob=await IO.zipBlob(null,entries,zipProgress);if(handle){await IO.permission(handle);await IO.write(handle,blob,zipProgress)}else download(blob,name+'.zip')}
      }else if(format==='markdown'||format==='obsidian'){
        const obsidian=format==='obsidian',entries=await E.markdown(records,state.resources,{obsidian,combined:combined&&!obsidian,name,branches:state.branches,allBranches:$('export-all-branches').checked,thoughts:$('export-thoughts').checked,tools:$('export-tools').checked,resolveResource:resourceBlob,onProgress:(done,total)=>report('生成导出内容',done,total)});
        download(await pack(entries),name+(obsidian?'-Obsidian.zip':'-Markdown.zip'));
      }else{
        const groups=combined?[records]:records.map(r=>[r]),entries=[],used=new Set();
        let done=0;
        for(const group of groups){
          await report('生成导出内容',done,groups.length);
          const payload=await E.payload(group,state.resources,exportSettings);
          if(format==='html'){
            const blob=new Blob([E.html(exportShell,payload)],{type:'text/html'});
            if(combined)download(blob,name+'.html');
            else entries.push({path:E.unique(E.filename(title(group[0])),used)+'.html',blob});
          }else{
            const folder=combined?'':E.unique(E.filename(title(group[0])),used)+'/';
            entries.push({path:folder+'conversations.json',blob:new Blob([payload.sources[0].text],{type:'application/json'})});
            for(const item of payload.archive){const binary=atob(item.base64),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));entries.push({path:folder+item.path,blob:new Blob([bytes],{type:item.mime})})}
          }
          done++;
        }
        if(entries.length)download(await pack(entries),format==='html'?name+'-HTML.zip':name+I.t('-原始结构.zip'));
      }
      $('export-dialog').close();zipProgress('导出完成',100);notify('导出完成，使用的是当前草稿；不会覆盖原始导出目录。');
    }catch(error){if(error.name!=='AbortError')notify('导出失败：'+error.message,true)}
    finally{setBusy(false);$('export-cancel').disabled=false;updateExportOptions()}
  }
  function closeWorkspace(force=false){if(state.busy&&!force)return;state.loadToken++;reset();state.savedSign=signature();$('app').hidden=true;$('loader').hidden=false;notify('资料已关闭，可以重新选择目录');updateChanges()}
  function requestClose(){
    if(state.busy)return;
    if(!unsaved()&&!editorChanged()){closeWorkspace();return}
    $('leave-message').textContent='';$('leave-confirm-download').hidden=true;$('leave-dialog').showModal();
  }
  async function saveBeforeClose(asNew){
    $('leave-message').textContent='正在保存…';
    const ok=typeof asNew==='string'?await saveAsChoice(asNew):await saveWorkspace(asNew);
    if(ok&&state.lastSaveDownload){$('leave-message').textContent='已生成下载。请确认下载完成后再关闭，避免丢失草稿。';$('leave-confirm-download').hidden=false}
    else if(ok&&!unsaved()&&!editorChanged()){$('leave-dialog').close();closeWorkspace()}
    else if(ok)$('leave-message').textContent=I.t('保存期间又有新的修改，请再次保存。');
    else if(ok===null){state.closeAfterSave=true;$('leave-message').textContent='请选择另存位置，完成后关闭资料。'}
    else $('leave-message').textContent='保存没有完成，资料与修改仍保留在当前页面。';
  }
  async function loadBaked() {
    try {
      const payload = C.parse($('data').textContent);
      if (!payload || payload.version !== 2 || !Array.isArray(payload.sources)) return;
      const entries = [];
      for (const item of payload.archive || []) {
        if (!C.validPath(item.path)) throw new Error('内嵌附件路径无效');
        const binary = atob(item.base64), chunks = [];
        for (let p = 0; p < binary.length; p += 65536) chunks.push(Uint8Array.from(binary.slice(p,p+65536), x => x.charCodeAt(0)));
        entries.push({path:item.path,blob:new Blob(chunks,{type:item.mime || 'application/octet-stream'})});
        if (entries.length % 10 === 0) await yieldUI();
      }
      await loadEntries(entries,payload.sources,{kind:'embedded',name:'HTML',baseline:new Map()});
    } catch (error) { if ($('data').textContent.trim() !== 'null') notify('内嵌数据读取失败：' + error.message,true); }
  }
  $('selection-import').addEventListener('click',openImport);
  $('import-cancel').addEventListener('click',()=>$('import-dialog').close());
  $('import-directory').addEventListener('click',()=>chooseImport('directory'));$('import-zip').addEventListener('click',()=>chooseImport('zip'));
  $('import-folder-input').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';if(files.length)runImport(()=>directoryInputEntries(files))});
  $('import-zip-input').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(file)runImport(async()=>(await IO.zip(file,null,zipProgress)).entries)});
  $('folder-input').addEventListener('change', event => { if (event.target.files.length) selectedFiles(event.target.files); event.target.value = ''; });
  $('new-folder').addEventListener('click', () => $('open-dialog').showModal());
  $('open-directory').addEventListener('click',openDirectory);$('open-zip').addEventListener('click',openZIP);
  $('choose-directory').addEventListener('click',()=>{$('open-dialog').close();openDirectory()});$('choose-zip').addEventListener('click',()=>{$('open-dialog').close();openZIP()});$('open-cancel').addEventListener('click',()=>$('open-dialog').close());
  $('zip-input').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(file)try{const opened=await readZIP(file);await loadEntries(opened.entries,null,opened.source)}catch(error){notify('打开 ZIP 失败：'+error.message,true)}});
  for(const dialog of document.querySelectorAll('dialog')){
    dialog.addEventListener('close',()=>dialog.querySelector('.dialog-status')?.remove());
    dialog.addEventListener('cancel',event=>{if(state.busy&&!(state.saving&&dialog.id==='editor')){event.preventDefault();notify('正在处理，请等待完成')}});
  }
  const narrowSidebar=window.matchMedia?.('(max-width:720px)');
  function sidebarIsOpen(){return narrowSidebar?.matches?document.body.classList.contains('sidebar-open'):!document.body.classList.contains('sidebar-collapsed')}
  function syncSidebar(){const open=sidebarIsOpen();$('conversation-sidebar').setAttribute('aria-hidden',String(!open));for(const id of ['menu','sidebar-close'])$(id).setAttribute('aria-expanded',String(open))}
  function setSidebarOpen(open){
    const container=$('chat-container'),anchor=N.capture(container);
    if(narrowSidebar?.matches)document.body.classList.toggle('sidebar-open',open);
    else{document.body.classList.remove('sidebar-open');document.body.classList.toggle('sidebar-collapsed',!open)}
    syncSidebar();N.restore(container,anchor);
  }
  const closeSidebar=()=>{setSidebarOpen(false);$('menu').focus?.({preventScroll:true})};
  $('menu').addEventListener('click',()=>{setSidebarOpen(!sidebarIsOpen());if(sidebarIsOpen())$('sidebar-close').focus?.({preventScroll:true})});
  $('sidebar-close').addEventListener('click',closeSidebar);
  $('sidebar-shade').addEventListener('click',closeSidebar);
  narrowSidebar?.addEventListener?.('change',()=>{document.body.classList.remove('sidebar-open');syncSidebar()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&narrowSidebar?.matches&&sidebarIsOpen()&&![...document.querySelectorAll('dialog')].some(dialog=>dialog.open)){closeSidebar();event.preventDefault()}});
  I.setAttribute($('sidebar-close'),'title','收起侧栏');I.setAttribute($('sidebar-close'),'aria-label','收起侧栏');I.setAttribute($('menu'),'title','展开侧栏');I.setAttribute($('menu'),'aria-label','展开侧栏');syncSidebar();
  let searchTimer; $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList,180); });
  for(const id of ['search-body','search-mode','search-case','search-whole','search-accents'])$(id).addEventListener('change',renderList);
  $('multi-toggle').addEventListener('click',()=>{state.multi=!state.multi;if(!state.multi){state.selected.clear();state.selectionAnchor=null;}updateSelection();renderList()});
  $('select-visible').addEventListener('click',()=>{state.multi=true;for(const key of state.visibleKeys||[])state.selected.add(key);updateSelection();renderList()});
  $('select-none').addEventListener('click',()=>{state.selected.clear();updateSelection();renderList()});
  $('select-invert').addEventListener('click',()=>{if(state.busy)return;state.multi=true;state.selectionAnchor=null;for(const key of state.visibleKeys||[])state.selected.has(key)?state.selected.delete(key):state.selected.add(key);updateSelection();renderList()});
  $('select-starred').addEventListener('click',()=>{
    if(state.busy)return;
    const starred=activeRecords().filter(record=>state.stars.has(record.key));
    if(!starred.length)return;
    state.multi=true;state.selectionAnchor=null;
    for(const record of starred)state.selected.add(record.key);
    updateSelection();renderList();
  });
  $('selection-delete').addEventListener('click',()=>deleteRecords([...state.selected]));$('selection-export').addEventListener('click',()=>openExport([...state.selected]));
  $('sort-order').addEventListener('change',()=>{if(state.busy){$('sort-order').value=displaySort();return}if(!state.editMode){const value=$('sort-order').value;if(value!=='manual'){state.viewSort=value;state.listLimit=200;renderList()}else $('sort-order').value=displaySort();return}const before=orderState(),beforeSort=state.sort,wasModified=state.orderModified;state.sort=$('sort-order').value;if(state.sort!==beforeSort){journal?.recordOrder?.(before,orderState());state.undo.push(audit.track({kind:'order',before:[...state.order],after:[...state.order],beforeSort,afterSort:state.sort,wasModified,target:state.current}));state.redo=[];state.orderModified=true}state.listLimit=200;updateChanges();renderList()});
  $('conv-list').addEventListener('scroll',()=>{for(const menu of $('conv-list').querySelectorAll('.conversation-menu'))menu.open=false},{passive:true});
  for(const id of ['export-format','export-layout','export-range'])$(id).addEventListener('change',updateExportOptions);
  $('export-cancel').addEventListener('click',()=>$('export-dialog').close());$('export-start').addEventListener('click',exportSelection);
  $('search-prev').addEventListener('click',()=>navigateSearch(-1));$('search-next').addEventListener('click',()=>navigateSearch(1));
  $('search-clear').addEventListener('click',()=>{$('search').value='';state.search={query:'',hits:[],cursor:-1};updateSearchPosition();renderList();renderCurrent(true)});
  $('search').addEventListener('keydown',async event=>{if(event.key==='Enter'){event.preventDefault();await renderList();navigateSearch(event.shiftKey?-1:1)}});
  $('show-thoughts').addEventListener('change', () => renderCurrent(true));
  $('show-tool').addEventListener('change', () => renderCurrent(true));
  $('branch').addEventListener('change', () => { if (state.current) { state.branches.set(state.current,$('branch').value); renderCurrent(false,true); } });
  $('edit-title').addEventListener('click',editTitle);$('edit-mode').addEventListener('click',toggleEditMode);
  $('cancel-edit').addEventListener('click',() => {$('editor').close();editorChanged=()=>false;for(const editor of activeEditors)editor.destroy();activeEditors=[];updateChanges()});
  $('editor').addEventListener('close',()=>{editorChanged=()=>false;for(const editor of activeEditors)editor.destroy();activeEditors=[];updateChanges()});
  $('undo').addEventListener('click',() => historyEdit('undo'));
  $('redo').addEventListener('click',() => historyEdit('redo'));
  for(const format of ['html','markdown','obsidian','json','directory','zip'])$('quick-'+format).addEventListener('click',()=>openExport(undefined,format));
  $('save-workspace').addEventListener('click',()=>saveWorkspace(false));$('save-as-workspace').addEventListener('click',()=>saveAsChoice('directory'));$('save-as-zip-workspace').addEventListener('click',()=>saveAsChoice('zip'));
  $('document-state').addEventListener('click',showChanges);$('history-close').addEventListener('click',()=>$('history-dialog').close());
  const menus=[...document.querySelectorAll('.exclusive-menu')];
  function closeMenus(except){hideExportFlyout();for(const menu of menus)if(menu!==except)menu.open=false}
    for(const menu of menus){menu.querySelector('summary').addEventListener('click',event=>{if(menu.classList.contains('disabled')){event.preventDefault();return}closeMenus(menu)});menu.addEventListener('toggle',()=>{if(menu.classList.contains('disabled')){menu.open=false;return}if(menu.open)closeMenus(menu)})}
  document.addEventListener('click',event=>{if(!event.target.closest('.exclusive-menu'))closeMenus()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus()});
  const menuActions={'menu-open':openDirectory,'menu-open-zip':openZIP,'menu-import':openImport,'menu-mode':toggleEditMode,'menu-star':()=>toggleStar(state.current),'menu-save':()=>saveWorkspace(false),'menu-save-as-directory':()=>saveAsChoice('directory'),'menu-save-as-zip':()=>saveAsChoice('zip'),'menu-undo':()=>historyEdit('undo'),'menu-redo':()=>historyEdit('redo'),'menu-title':editTitle,
    'menu-display':()=>{$('appearance-menu').open=true},'menu-language':()=>{$('language-menu').open=true}};
  for(const [id,action]of Object.entries(menuActions))$(id).addEventListener('click',()=>{closeMenus();action()});
  $('menu-close').addEventListener('click',requestClose);
  $('menu-export-open').addEventListener('click',()=>openExport());
  function hideExportFlyout(){$('export-flyout').hidden=true;$('menu-export-arrow').setAttribute('aria-expanded','false')}
  function showExportFlyout(){
    const flyout=$('export-flyout');flyout.hidden=false;$('menu-export-arrow').setAttribute('aria-expanded','true');
    const rect=$('menu-export-arrow').getBoundingClientRect?.()||{right:300,left:270,top:100},width=220,height=330;
    flyout.style.left=Math.max(8,rect.right+width>(window.innerWidth||1200)?rect.left-width:rect.right+4)+'px';
    flyout.style.top=Math.max(8,Math.min(rect.top,(window.innerHeight||800)-height-8))+'px';
  }
  $('menu-export-arrow').addEventListener('click',event=>{event.preventDefault();$('export-flyout').hidden?showExportFlyout():hideExportFlyout()});
  $('menu-export-arrow').addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();showExportFlyout();$('flyout-html').focus()}});
  $('export-flyout').addEventListener('keydown',event=>{
    if(['Escape','ArrowLeft'].includes(event.key)){event.preventDefault();hideExportFlyout();$('menu-export-arrow').focus();return}
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...$('export-flyout').querySelectorAll('button')],i=buttons.indexOf(event.target);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
  });
  for(const format of ['html','markdown','obsidian','json','pdf','print','directory','zip'])$('flyout-'+format).addEventListener('click',()=>{closeMenus();if(format==='pdf'||format==='print')openPrint(format==='pdf');else openExport(undefined,format)});
  $('leave-cancel').addEventListener('click',()=>{state.closeAfterSave=false;$('leave-dialog').close()});
  $('leave-discard').addEventListener('click',()=>{if(state.busy)return;$('leave-dialog').close();editorChanged=()=>false;$('editor').close();closeWorkspace()});
  $('leave-save').addEventListener('click',()=>saveBeforeClose(false));$('leave-save-as').addEventListener('click',()=>saveBeforeClose('zip'));$('leave-save-as-directory').addEventListener('click',()=>saveBeforeClose('directory'));
  const confirmDownloaded=()=>{if(state.downloadFiles)state.savedFileEdits=state.downloadFiles;state.inputTexts.clear();if(journal&&state.downloadJournal)journal.accept(state.downloadJournal);if(state.downloadHistory)historyStore.accept(state.downloadHistory);renderList();state.savedStructuralRevision=state.downloadRevision??state.structuralRevision??0;markModeSaved(state.downloadModeCheckpoint);state.savedSign=state.downloadSign;audit.markSaved(state.downloadAudit,state.source?.name);state.downloadPending=false;updateChanges()};
  $('confirm-download').addEventListener('click',confirmDownloaded);
  $('leave-confirm-download').addEventListener('click',()=>{confirmDownloaded();if(!unsaved()){$('leave-dialog').close();closeWorkspace()}else $('leave-message').textContent='下载后还有新的修改，请再次保存。'});
  window.addEventListener('popstate', fromHash); window.addEventListener('hashchange', fromHash);
  document.addEventListener('keydown', event => {
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();openPrint(false);return}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveWorkspace(event.shiftKey);return}
    if (!(event.ctrlKey || event.metaKey) || /^(INPUT|TEXTAREA)$/.test(event.target.tagName) || $('editor').open) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); historyEdit(event.shiftKey ? 'redo' : 'undo'); }
  });
  window.addEventListener('beforeunload', event => { rememberReading();if (state.saving||unsaved()||editorChanged()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', event => { if (!event.persisted) revoke(); });
  let dragDepth=0,internalDrag=false;
  const externalDrag=event=>!internalDrag&&[...(event.dataTransfer?.types||[])].includes('Files')&&!$('editor').open;
  const hideDrop=()=>{dragDepth=0;document.body.classList.remove('external-drop')};
  document.addEventListener('dragstart',event=>{if(!event.target.closest('#editor')){if(event.target.closest('img,audio,video')){event.preventDefault();internalDrag=false}else internalDrag=true}});
  document.addEventListener('dragend',()=>{internalDrag=false;hideDrop()});
  document.body.addEventListener('dragenter',event=>{if(!externalDrag(event))return;event.preventDefault();dragDepth++;document.body.classList.add('external-drop')});
  document.body.addEventListener('dragover',event=>{if(!externalDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy'});
  document.body.addEventListener('dragleave',event=>{if(externalDrag(event)&&--dragDepth<=0)hideDrop()});
  window.addEventListener('blur',hideDrop);
  document.body.addEventListener('drop',event=>{
    const external=externalDrag(event),allowed=true;hideDrop();internalDrag=false;
    if(!external)return;event.preventDefault();if(!allowed||state.busy)return;
    const captured=ViewerTransfer.capture(event.dataTransfer);
    (async()=>{
      const handles=(await Promise.all(captured.handles)).filter(Boolean);let opened;
      if(handles.length===1&&handles[0].kind==='directory')opened=await IO.directory(handles[0]);
      else if(handles.length===1&&/\.zip$/i.test(handles[0].name))opened=await readZIP(await handles[0].getFile(),handles[0]);
      else{const entries=await ViewerTransfer.read(captured);opened=entries.length===1&&/\.zip$/i.test(entries[0].path)?await readZIP(entries[0].blob):{entries}}
      await loadEntries(opened.entries,null,opened.source);
    })().catch(error=>notify('拖入失败：'+error.message,true));
  });
  const fonts={system:'ui-sans-serif, system-ui, sans-serif',sans:'"Microsoft YaHei", "PingFang SC", sans-serif',serif:'SimSun, "Noto Serif CJK SC", serif',mono:'Consolas, "Cascadia Code", monospace'};
  let preferences={theme:'system',font:'system',zoom:100,wide:false,sidebar:300,outline:true};
  try{const saved=JSON.parse(localStorage.getItem('viewer-appearance-v5')||'null');if(saved)preferences={...preferences,...saved}}catch(_){}
  function applyPreferences(){
    const anchor=N.capture($('chat-container')),guard=state.userScroll,viewToken=state.token;
    if(!['dark','light','system','sepia','midnight','forest','rose','contrast'].includes(preferences.theme))preferences.theme='system';
    if(!fonts[preferences.font])preferences.font='system';preferences.zoom=Math.max(70,Math.min(200,Number(preferences.zoom)||100));
    document.body.dataset.theme=preferences.theme==='system'?(window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark'):preferences.theme;
    document.documentElement?.style.setProperty('--chat-size',(16*preferences.zoom/100)+'px');
    document.documentElement?.style.setProperty('--chat-family',fonts[preferences.font]);
    document.body.classList.toggle('wide-screen',!!preferences.wide);$('wide-screen').checked=!!preferences.wide;applySidebarWidth(preferences.sidebar,false);
    turnOutline?.setEnabled(preferences.outline!==false);$('show-outline').checked=preferences.outline!==false;
    $('theme').value=preferences.theme;$('chat-font').value=preferences.font;$('zoom-label').textContent=preferences.zoom+'%';
    try{localStorage.setItem('viewer-appearance-v5',JSON.stringify(preferences))}catch(_){}
    N.restore($('chat-container'),anchor);document.fonts?.ready.then(()=>{if(guard===state.userScroll&&viewToken===state.token)N.restore($('chat-container'),anchor)});
  }
  $('wide-screen').addEventListener('change',()=>{preferences.wide=$('wide-screen').checked;applyPreferences()});
  $('show-outline').addEventListener('change',()=>{preferences.outline=$('show-outline').checked;applyPreferences()});
  $('language').addEventListener('change',()=>{I.setLanguage($('language').value);for(const copy of $('msgs').querySelectorAll('.copy-code'))I.setText(copy,copy.dataset.copied?'已复制':'复制代码');updateSelection();updateChanges();updateSourceInfo();const r=current();if(r){$('title').textContent=title(r);$('meta').textContent=format(r.raw.update_time||r.raw.create_time);for(const option of $('branch').querySelectorAll('option'))option.textContent=option.value==='__all__'?I.t('全部分支（按时间显示）'):branchLabel(r,option.value)}updateSearchPosition();for(const time of $('msgs').querySelectorAll('time[data-timestamp]'))time.textContent=format(Number(time.dataset.timestamp));state.search.query=null;renderList()});
  $('theme').addEventListener('change',()=>{preferences.theme=$('theme').value;applyPreferences()});
  $('chat-font').addEventListener('change',()=>{preferences.font=$('chat-font').value;applyPreferences()});
  $('zoom-in').addEventListener('click',()=>{preferences.zoom+=10;applyPreferences()});$('zoom-out').addEventListener('click',()=>{preferences.zoom-=10;applyPreferences()});$('zoom-reset').addEventListener('click',()=>{preferences.zoom=100;applyPreferences()});
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change',applyPreferences);
  $('chat-container').addEventListener('scroll',()=>{clearTimeout(readingTimer);readingTimer=setTimeout(rememberReading,200)},{passive:true});
  window.addEventListener('pagehide',rememberReading);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')rememberReading()});
  for(const type of ['wheel','touchstart','pointerdown'])$('chat-container').addEventListener(type,()=>state.userScroll++,{passive:true});
  document.addEventListener('keydown',event=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key)&&!$('editor').open)state.userScroll++});

  function openPrint(pdf,keys,scope=null){
    if(state.busy||!state.records.length){notify('请先打开聊天资料');return}
    flushEditor();closeMenus();state.printKeys=keys===undefined?[...state.selected]:keys;
    $('print-heading').textContent=pdf?'导出 PDF':'打印';$('print-scope').value=scope||(state.printKeys.length?'selected':current()?'current':'all');$('print-font').value=String(12*preferences.zoom/100);
    $('print-dialog').showModal();
  }
  async function startPrint(){
    flushEditor();if(state.busy)return;
    const scope=$('print-scope').value,records=orderedRecords().filter(r=>scope==='all'||scope==='current'&&r.key===state.current||scope==='selected'&&(state.printKeys?state.printKeys.includes(r.key):state.selected.has(r.key)));
    if(!records.length){notify('没有可打印的聊天，请检查选择范围',true);return}
    try{
      setBusy(true);$('print-start').disabled=$('print-cancel').disabled=true;
      zipProgress('准备打印');await yieldUI();
      const report=exportProgress(),result=await Print.build(records,{paper:$('print-paper').value,width:$('paper-width').value,height:$('paper-height').value,orientation:$('print-orientation').value,margin:$('print-margin').value,font:$('print-font').value,thoughts:$('print-thoughts').checked,tools:$('print-tools').checked},{document,markdown,resources:state.resources,resolveResource:resourceBlob,branches:state.branches,translate:I.t,fontFamily:fonts[preferences.font],onProgress:(done,total)=>report('生成打印内容',done,total)});
      document.getElementById('print-document')?.remove();document.getElementById('print-page-style')?.remove();
      const style=document.createElement('style');style.id='print-page-style';style.textContent=result.style;document.head.append(style);document.body.append(result.element);
      zipProgress('加载打印字体和图片');await document.fonts?.ready;
      await Promise.all([...result.element.querySelectorAll('img')].map(image=>typeof image.decode==='function'?image.decode().catch(()=>{}):Promise.resolve()));
      state.printReady=true;$('print-dialog').close();const oldTitle=document.title;document.title=records.length===1?title(records[0]):'ChatGPT 聊天记录';
      zipProgress('打开系统打印窗口');
      try{window.print()}finally{document.title=oldTitle}notify('已打开系统打印预览；导出 PDF 时请选择“另存为 PDF”');
    }catch(error){notify('打印准备失败：'+error.message,true)}finally{setBusy(false);$('print-start').disabled=$('print-cancel').disabled=false}
  }
  $('quick-pdf').addEventListener('click',()=>openPrint(true));$('quick-print').addEventListener('click',()=>openPrint(false));
  $('print-cancel').addEventListener('click',()=>{if(!state.busy)$('print-dialog').close()});$('print-start').addEventListener('click',startPrint);
  $('print-paper').addEventListener('change',()=>{$('custom-paper').hidden=$('print-paper').value!=='custom'});
  window.addEventListener('beforeprint',()=>{
    if(state.printReady)return;
    document.getElementById('print-document')?.remove();const notice=text('div',I.t('请使用软件的“文件 → 导出为 → 打印”或打印图标，准备完整聊天后再打印。'),'print-document');notice.id='print-document';document.body.append(notice);
  });
  function applySidebarWidth(value,persist=true){
    const max=Math.max(260,Math.min(640,(window.innerWidth||1200)-460));const width=Math.round(Math.max(260,Math.min(max,Number(value)||300)));
    document.documentElement.style.setProperty('--sidebar-width',width+'px');$('sidebar-resizer').setAttribute('aria-valuenow',width);$('sidebar-resizer').setAttribute('aria-valuemax',max);
    if(persist){preferences.sidebar=width;try{localStorage.setItem('viewer-appearance-v5',JSON.stringify(preferences))}catch(_){}}
    return width;
  }
  let resizeStart=null;
  $('sidebar-resizer').addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();resizeStart={x:event.clientX,width:Number($('sidebar-resizer').getAttribute('aria-valuenow'))};$('sidebar-resizer').setPointerCapture?.(event.pointerId);document.body.classList.add('resizing-sidebar')});
  $('sidebar-resizer').addEventListener('pointermove',event=>{if(resizeStart)applySidebarWidth(resizeStart.width+(event.clientX-resizeStart.x)*(document.documentElement.dir==='rtl'?-1:1))});
  const stopResize=()=>{resizeStart=null;document.body.classList.remove('resizing-sidebar')};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])$('sidebar-resizer').addEventListener(type,stopResize);
  $('sidebar-resizer').addEventListener('dblclick',()=>applySidebarWidth(300));
  $('sidebar-resizer').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const current=Number($('sidebar-resizer').getAttribute('aria-valuenow'));applySidebarWidth(event.key==='Home'?260:event.key==='End'?640:current+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:10)*(document.documentElement.dir==='rtl'?-1:1))});
  window.addEventListener('resize',()=>applySidebarWidth(preferences.sidebar,false));
  async function jumpToTurn(entry,recordKey){
    const record=current();if(!record||record.key!==recordKey)return;
    const jumpToken=state.turnJumpToken=(state.turnJumpToken||0)+1,branch=C.branch(record.raw,state.branches.get(record.key)),nodes=C.nodeMap(record.raw);
    const visible=branch.ids.filter(id=>{const message=nodes[id]?.message;if(!C.object(message))return false;const info=C.classification(message);return (!info.thought||$('show-thoughts').checked)&&(!info.tool||$('show-tool').checked)}),position=visible.indexOf(entry.node);
    if(position<0)return;state.userScroll++;
    let article=[...$('msgs').querySelectorAll('article')].find(el=>el.dataset.node===entry.node);
    if(!article){
      state.limits.set(record.key+':'+branch.leaf,Math.max(state.limits.get(record.key+':'+branch.leaf)||40,Math.ceil((position+1)/40)*40));await renderCurrent();
      if(current()!==record||jumpToken!==state.turnJumpToken||C.branch(record.raw,state.branches.get(record.key)).leaf!==branch.leaf)return;
      article=[...$('msgs').querySelectorAll('article')].find(el=>el.dataset.node===entry.node);
    }
    const scroller=$('chat-container');
    if(article?.getBoundingClientRect&&scroller.getBoundingClientRect)scroller.scrollTop=Math.max(0,article.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop);
    else article?.scrollIntoView?.({block:'start',behavior:'auto'});
    turnOutline?.refresh();turnOutline?.setActive(turnOutline.getRows().findIndex(row=>row.node===entry.node));
  }
  turnOutline=ViewerOutline.create({document,rail:$('turn-outline'),marks:$('turn-marks'),preview:$('turn-preview'),scroller:$('chat-container'),region:$('reading-region'),content:$('msgs'),view:window,onJump:jumpToTurn,onError:error=>notify('定位失败：'+error.message,true)});
  audit=ViewerHistory.create({state,unsaved});
  I.observe();
  applyPreferences();
  updateChanges(); loadBaked();
})();
