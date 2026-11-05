/* Immutable save batches. The index contains pointers, never message bodies. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_core.js'));else root.ViewerJournalStore=factory(root.ViewerCore)})(globalThis,function(C){
 'use strict';
 const path='.viewer-state/viewer-history.json',prefix='.viewer-backups/segments/';
 const managed=p=>/^\.viewer-backups\/segments\/[a-z0-9-]+\.json$/.test(p);
 const empty=()=>({version:141,enabled:true,records:{},bindings:[],orders:[]});
 const failure=()=>new Error('增量历史格式不受支持');
 const checksum=text=>text.length+':'+C.crc32(new TextEncoder().encode(text)).toString(16);
 const meta=value=>{const {versions,...rest}=value;return rest};
 function snapshot(data){return {...data,records:Object.fromEntries(Object.entries(data.records).map(([uid,value])=>[uid,{...value,versions:[...value.versions]}])),bindings:data.bindings.map(b=>({...b})),orders:[...data.orders]}}
 function create(){
  let index=null,base=empty(),known=[],batches=[],force=false;
  function reset(){index=null;base=empty();known=[];batches=[];force=false}
  async function open(entries,file=entries.get(path)){
   reset();known=[...entries.keys()].filter(managed);if(!file)return null;
   const saved=C.parse(await file.blob.text());if(saved.version!==143)return saved;
   if(!Array.isArray(saved.bindings)||typeof saved.enabled!=='boolean'||saved.head!==null&&!managed(saved.head))throw failure();
   index=saved;const seen=new Set(),chain=[];let head=saved.head,expected=saved.headHash;
   while(head){if(seen.has(head))throw failure();seen.add(head);const entry=entries.get(head);if(!entry)throw failure();const raw=await entry.blob.text();if(checksum(raw)!==expected)throw failure();const batch=C.parse(raw);
    if(batch.version!==143||prefix+batch.id+'.json'!==head||batch.previous!==null&&!managed(batch.previous)||!C.object(batch.changes)||!C.object(batch.changes.records)||!Array.isArray(batch.changes.orders))throw failure();chain.push({path:head,hash:expected,batch});head=batch.previous;expected=batch.previousHash;
   }
   batches=chain.reverse();const data=empty();for(const {batch} of batches){
    for(const [uid,update]of Object.entries(batch.changes.records)){if(!C.object(update.meta)||!Array.isArray(update.versions))throw failure();const old=data.records[uid]?.versions||[],ids=new Set(old.map(v=>v.id));for(const v of update.versions){if(!v||typeof v.id!=='string'||ids.has(v.id))throw failure();ids.add(v.id)}data.records[uid]={...update.meta,versions:[...old,...update.versions]}}
    data.orders.push(...batch.changes.orders);
   }
   data.bindings=saved.bindings;data.enabled=saved.enabled;return data;
  }
  function align(data,repair=false){base=snapshot(data);force=repair}
  // Keep every surviving checkpoint in its original batch. The 143 hash chain
  // requires relinking the suffix after the first changed batch, not flattening
  // that suffix (or the unaffected prefix) into one aggregate payload.
  function retainedChanges(data){
   const versions=new Map(Object.entries(data.records).map(([uid,value])=>[uid,new Map(value.versions.map(v=>[v.id,v]))])),orders=new Map(data.orders.map(v=>[v.id,v])),last=new Map();
   const parts=batches.map(({batch})=>{
    const changes={records:{},orders:[]};
    for(const [uid,update] of Object.entries(batch.changes.records)){
     const remaining=versions.get(uid);if(!remaining)continue;
     const kept=[];for(const old of update.versions)if(remaining.has(old.id)){kept.push(remaining.get(old.id));remaining.delete(old.id)}
     if(kept.length){changes.records[uid]={meta:update.meta,versions:kept};last.set(uid,changes.records[uid])}
    }
    for(const old of batch.changes.orders)if(orders.has(old.id)){changes.orders.push(orders.get(old.id));orders.delete(old.id)}
    return changes;
   });
   const added={records:{},orders:[...orders.values()]};
   for(const [uid,value] of Object.entries(data.records)){
    const remaining=[...versions.get(uid).values()];
    if(remaining.length||!last.has(uid))added.records[uid]={meta:meta(value),versions:remaining};
    else last.get(uid).meta=meta(value);
   }
   return {parts,added};
  }
  function prepare(data){
   const changes={records:{},orders:[]};const clearBackupFolder=!Object.values(data.records).some(m=>m.versions?.length)&&!data.orders.length;let rewrite=force||!index||clearBackupFolder;
   for(const uid of Object.keys(base.records))if(!data.records[uid])rewrite=true;
   for(const [uid,value]of Object.entries(data.records)){
    const old=base.records[uid],oldVersions=new Map((old?.versions||[]).map(v=>[v.id,v])),nextIds=new Set(value.versions.map(v=>v.id));
    if(old&&old.versions.some(v=>!nextIds.has(v.id)))rewrite=true;
    const added=[];for(const v of value.versions){const prior=oldVersions.get(v.id);if(prior&&prior!==v&&JSON.stringify(prior)!==JSON.stringify(v))rewrite=true;else if(!prior)added.push(v)}
    if(added.length||!old||JSON.stringify(meta(value))!==JSON.stringify(meta(old)))changes.records[uid]={meta:meta(value),versions:added};
   }
   if(data.orders.length<base.orders.length||base.orders.some((v,i)=>v!==data.orders[i]&&JSON.stringify(v)!==JSON.stringify(data.orders[i])))rewrite=true;else changes.orders=data.orders.slice(base.orders.length);
   const removedPaths=new Set(rewrite?known:[]),entries=[],nextBatches=rewrite?[]:[...batches],reserved=new Set(known);let head=rewrite?null:index.head,headHash=rewrite?null:index.headHash;
   function append(changes,original){
    if(!Object.keys(changes.records).length&&!changes.orders.length)return;
    if(original&&original.batch.previous===head&&original.batch.previousHash===headHash&&JSON.stringify(original.batch.changes)===JSON.stringify(changes)){
     head=original.path;headHash=original.hash;nextBatches.push(original);removedPaths.delete(head);return;
    }
    let id;do{id=new Date().toISOString().toLowerCase().replace(/[-:.]/g,'')+'-'+Math.random().toString(36).slice(2)}while(reserved.has(prefix+id+'.json'));
    const batch={version:143,id,previous:head,previousHash:headHash,changes},raw=JSON.stringify(batch);head=prefix+id+'.json';headHash=checksum(raw);reserved.add(head);nextBatches.push({path:head,hash:headHash,batch});entries.push({path:head,blob:new Blob([raw],{type:'application/json'})});
   }
   if(rewrite&&index&&!force&&!clearBackupFolder){
    const {parts,added}=retainedChanges(data);parts.forEach((part,i)=>append(part,batches[i]));append(added);
   }else{
    if(rewrite){changes.records=Object.fromEntries(Object.entries(data.records).map(([uid,value])=>[uid,{meta:meta(value),versions:value.versions}]));changes.orders=data.orders}
    append(changes);
   }
   const next={version:143,enabled:Boolean(data.enabled),head,headHash,bindings:data.bindings};entries.push({path,blob:new Blob([JSON.stringify(next)],{type:'application/json'})});
   return {entries,removedPaths,clearBackupFolder,index:next,data,snapshot:snapshot(data),batches:nextBatches,known:[...known.filter(p=>!removedPaths.has(p)),...entries.map(e=>e.path).filter(managed)]};
  }
  function accept(plan){index=plan.index;base=plan.snapshot;known=plan.known;batches=plan.batches;force=false}
  return {reset,open,align,prepare,accept};
 }
 return {create,path,prefix,managed};
});
