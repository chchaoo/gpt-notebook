/* Persistent per-conversation reverse deltas. No full live-file snapshots. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_core.js'));else root.ViewerJournal=factory(root.ViewerCore)})(globalThis,function(C){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)),id=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),hash=s=>s.length+':'+C.crc32(new TextEncoder().encode(s)).toString(16);
 function splice(from,to){let at=0,end=0;while(at<from.length&&at<to.length&&from[at]===to[at])at++;while(end<from.length-at&&end<to.length-at&&from[from.length-1-end]===to[to.length-1-end])end++;return {at,remove:from.slice(at,from.length-end),insert:to.slice(at,to.length-end)}}
 function hunks(from,to){
  const out=[];
  function range(a,b,c,d,depth){
   while(a<b&&c<d&&from[a]===to[c]){a++;c++}while(b>a&&d>c&&from[b-1]===to[d-1]){b--;d--}
   if(a===b&&c===d)return;
   if(depth<16&&b-a>256&&d-c>256&&out.length<256){
    for(const fraction of [.5,.25,.75]){
     const at=Math.floor(a+(b-a-64)*fraction),pattern=from.slice(at,at+64),expected=c+at-a;
     const choices=[to.indexOf(pattern,Math.max(c,expected-128)),to.lastIndexOf(pattern,Math.min(d-64,expected+128))].filter(i=>i>=c&&i+64<=d).sort((x,y)=>Math.abs(x-expected)-Math.abs(y-expected));
     if(choices.length){let start=at,other=choices[0],end=at+64,last=other+64;while(start>a&&other>c&&from[start-1]===to[other-1]){start--;other--}while(end<b&&last<d&&from[end]===to[last]){end++;last++}range(a,start,c,other,depth+1);range(end,b,last,d,depth+1);return}
    }
   }
   out.push({at:a,remove:from.slice(a,b),insert:to.slice(c,d)});
  }
  range(0,from.length,0,to.length,0);return out.sort((a,b)=>b.at-a.at);
 }
 function apply(raw,patch){
  if(hash(raw)!==patch.from)throw new Error('历史校验不一致，已停止恢复');
  let result=raw;
  if(patch.raw){const p=patch.raw;if(result.slice(p.at,p.at+p.remove.length)!==p.remove)throw new Error('历史增量不匹配');result=result.slice(0,p.at)+p.insert+result.slice(p.at+p.remove.length)}
  else{
   const text='['+raw+']',spans=C.spans(text,new Set(patch.fields.map(p=>C.key([0,...p.path])))),edits=[];
    for(const p of patch.fields){const span=spans.get(C.key([0,...p.path]));if(!span)throw new Error('历史字段不存在');let value=text.slice(...span);for(const h of p.hunks||[p]){if(value.slice(h.at,h.at+h.remove.length)!==h.remove)throw new Error('历史字段增量不匹配');value=value.slice(0,h.at)+h.insert+value.slice(h.at+h.remove.length)}edits.push({at:span[0]-1,end:span[1]-1,value})}
   for(const e of edits.sort((a,b)=>b.at-a.at))result=result.slice(0,e.at)+e.value+result.slice(e.end);
  }
  if(hash(result)!==patch.to)throw new Error('恢复结果校验失败');JSON.parse(result);return result;
 }
 function delta(from,to){
  const patch={from:hash(from),to:hash(to),fields:[]},paths=[];
  function walk(a,b,path){if(typeof a==='string'&&typeof b==='string'){if(a!==b)paths.push(path);return true}if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b)){return a.length===b.length&&a.every((v,i)=>walk(v,b[i],[...path,i]))}if(C.object(a)&&C.object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&walk(a[k],b[k],[...path,k]))}return false}
  if(walk(JSON.parse(from),JSON.parse(to),[])){
   const wanted=new Set(paths.map(p=>C.key([0,...p]))),a=C.spans('['+from+']',wanted),b=C.spans('['+to+']',wanted);
   patch.fields=paths.map(path=>({path,hunks:hunks(('['+from+']').slice(...a.get(C.key([0,...path]))),('['+to+']').slice(...b.get(C.key([0,...path]))))}));
   try{if(apply(from,patch)===to)return patch}catch(_){}
  }
  delete patch.fields;patch.raw=splice(from,to);return patch;
 }
 function materialize(head,versions){const out=[];let raw=head;for(let i=versions.length-1;i>=0;i--){raw=apply(raw,versions[i].delta);out[i]=raw}return out}
 function create(){
  const empty=()=>({version:141,enabled:true,records:{},bindings:[],orders:[]});
  let data=empty(),base={records:[],fields:new Map(),order:[],sort:'manual'},pending=[],orderPending=[],dirty=false,needsClearConfirmation=false;
  let viewRevision=0,restoredOrder=null;const restored=new Map(),positionCache=new Map();
  function refreshPositions(clear=false){viewRevision++;positionCache.clear();if(clear){restored.clear();restoredOrder=null}}
  const indices=new WeakMap(),fieldKey=(uid,path)=>C.key([uid,...path]),lookup=uid=>base.byUid?.get(uid)||base.records.find(r=>r.uid===uid);
  function index(doc){let old=indices.get(doc);if(!old||old.text!==doc.text){old={text:doc.text,spans:C.spans(doc.text,null)};indices.set(doc,old)}return old.spans}
  function info(r){if(!r.historyUid)r.historyUid=id();const old=lookup(r.historyUid)||data.records[r.historyUid]?.deleted;return {uid:r.historyUid,path:r.doc.path,index:old?.index??r.index,id:r.id||'',title:r.raw.title||'',previous:old?.previous||null,next:old?.next||null,record:r}}
  function literal(r,path,value){const full=[r.index,...path],span=index(r.doc).get(C.key(full));if(!span)throw new Error('历史字段不存在');const original=r.doc.text.slice(...span);const key=C.key(full),sourceValue=r.doc.originals.has(key)?r.doc.originals.get(key):C.parse(original);return sourceValue===value?original:JSON.stringify(value)}
  function rowRaw(entry,saved=false){
   const r=entry.record||entry,uid=entry.uid||r.historyUid,spans=index(r.doc),row=spans.get(C.key([r.index]));if(!row)throw new Error('会话索引不存在');let raw=r.doc.text.slice(...row);const edits=new Map();
   for(const edit of r.doc.changes.values())if(edit.path[0]===r.index)edits.set(C.key(edit.path.slice(1)),{path:edit.path.slice(1),raw:JSON.stringify(edit.value)});
   if(saved){for(const [key,value]of r.doc.originals){const path=JSON.parse(key);if(path[0]!==r.index)continue;const relative=path.slice(1),old=base.fields.get(fieldKey(uid,relative));edits.set(C.key(relative),{path:relative,raw:old?.literal??literal(r,relative,value)})}
    for(const field of base.fields.values())if(field.uid===uid)edits.set(C.key(field.path),{path:field.path,raw:field.literal});
   }
   const replacements=[];for(const edit of edits.values()){const span=spans.get(C.key([r.index,...edit.path]));if(span)replacements.push({at:span[0]-row[0],end:span[1]-row[0],raw:edit.raw})}
   for(const edit of replacements.sort((a,b)=>b.at-a.at))raw=raw.slice(0,edit.at)+edit.raw+raw.slice(edit.end);return raw;
  }
  function capture(records,order,settings={}){
   const values=records.map(info),byUid=new Map(values.map(r=>[r.uid,r])),fields=new Map(),docs=new Map();for(const r of values){if(!docs.has(r.record.doc))docs.set(r.record.doc,new Map());docs.get(r.record.doc).set(r.record.index,r)}
   function field(entry,path){const value=C.get(entry.record.raw,path);if(typeof value==='string'){const key=fieldKey(entry.uid,path),old=base.fields.get(key);fields.set(key,old?.value===value?old:{uid:entry.uid,path,value,literal:literal(entry.record,path,value)})}}
   for(const [doc,rows]of docs){const kept=new Set(rows.keys());let i=0;for(let n=0;n<doc.data.length;n++)if(kept.has(n)||!C.object(doc.data[n])||!C.object(doc.data[n].mapping)){if(rows.has(n))rows.get(n).index=i;i++}
    const sorted=[...rows.values()].sort((a,b)=>a.index-b.index);sorted.forEach((r,i)=>{r.previous=sorted[i-1]?.uid||null;r.next=sorted[i+1]?.uid||null});
    for(const key of doc.originals.keys()){const path=JSON.parse(key),r=rows.get(path[0]);if(r)field(r,path.slice(1))}
   }
   for(const old of base.fields.values()){const entry=byUid.get(old.uid);if(entry)field(entry,old.path)}
   const byKey=new Map(values.map(r=>[r.record.key,r.uid])),ordered=(order||records.map(r=>r.key)).map(key=>byKey.get(key)).filter(Boolean);for(const r of values)if(!ordered.includes(r.uid))ordered.push(r.uid);
   return {records:values,byUid,fields,order:ordered,sort:settings.sort||base.sort||'manual'};
  }
  function textOp(path,before,after){return {op:'text',path,from:hash(after),to:hash(before),edits:hunks(after,before)}}
  function applyEvent(raw,change){
   if(!change.ops)return apply(raw,change);
   for(const op of change.ops){
    if(op.op==='insert'){if(raw!==null)throw new Error('历史中的删除状态不一致');raw=op.raw;continue}
    if(op.op==='delete'){if(typeof raw!=='string'||hash(raw)!==op.from)throw new Error('历史中的插入状态不一致');raw=null;continue}
    if(typeof raw!=='string')throw new Error('缺少历史基准');
    if(op.op==='patch'){if(hash(raw)!==op.from)throw new Error('历史增量不匹配');for(const h of op.edits){if(raw.slice(h.at,h.at+h.remove.length)!==h.remove)throw new Error('历史增量不匹配');raw=raw.slice(0,h.at)+h.insert+raw.slice(h.at+h.remove.length)}if(hash(raw)!==op.to)throw new Error('恢复结果校验失败');continue}
    if(op.op!=='text')throw new Error('增量历史格式不受支持');const text='['+raw+']',span=C.spans(text,new Set([C.key([0,...op.path])])).get(C.key([0,...op.path]));if(!span)throw new Error('历史字段不存在');let value=text.slice(...span);if(hash(value)!==op.from)throw new Error('历史字段增量不匹配');
    for(const h of op.edits){if(value.slice(h.at,h.at+h.remove.length)!==h.remove)throw new Error('历史字段增量不匹配');value=value.slice(0,h.at)+h.insert+value.slice(h.at+h.remove.length)}if(hash(value)!==op.to)throw new Error('恢复结果校验失败');raw=raw.slice(0,span[0]-1)+value+raw.slice(span[1]-1);
   }
   if(raw!==null)JSON.parse(raw);return raw;
  }
  function rawDelta(before,after){if(before===after)return {ops:[]};if(before===null)return {ops:[{op:'delete',from:hash(after)}]};if(after===null)return {ops:[{op:'insert',raw:before}]};return {ops:[{op:'patch',from:hash(after),to:hash(before),edits:hunks(after,before)}]}}
  function enqueue(entry,delta,kind='edit'){const event={uid:entry.uid,entry,id:id(),time:new Date().toISOString(),delta,kind};pending.push(event);refreshPositions();return event}
  function recordFields(edits,records){if(!data.enabled)return;const groups=new Map();for(const edit of edits){const r=records.find(r=>r.doc===edit.doc&&r.index===edit.path[0]);if(!r)throw new Error('会话索引不存在');const entry=info(r);if(!groups.has(entry.uid))groups.set(entry.uid,{entry,paths:[]});groups.get(entry.uid).paths.push(edit.path.slice(1))}for(const {entry,paths}of groups.values())if(paths.length)enqueue(entry,{paths})}
  function recordRaw(r,before,after){if(data.enabled&&before!==after)enqueue(info(r),{structural:true},after===null?'delete':before===null?'insert':'edit')}
  function savedLiteral(entry,path){return base.fields.get(fieldKey(entry.uid,path))?.literal??literal(entry.record,path,C.parse(entry.record.doc.text.slice(...index(entry.record.doc).get(C.key([entry.record.index,...path])))))}
  function pendingNet(){
   const groups=new Map();for(const event of pending){if(!groups.has(event.uid))groups.set(event.uid,[]);groups.get(event.uid).push(event)}
   for(const [uid,events]of groups){const old=lookup(uid);let present=Boolean(old);for(const event of events){if(event.kind==='delete')present=false;else if(event.kind==='insert')present=true}if(present!==Boolean(old))return true;if(!present)continue;
    const current=events.at(-1).entry.record;if(events.some(e=>e.delta.structural)||old.record.doc!==current.doc){if(rowRaw(old,true)!==rowRaw(current))return true;continue}
    const paths=new Map();for(const event of events)for(const path of event.delta.paths||[])paths.set(C.key(path),path);for(const path of paths.values()){const prior=base.fields.get(fieldKey(uid,path)),original=old.record.doc.originals.get(C.key([old.record.index,...path])),before=prior?prior.value:original??C.parse(old.record.doc.text.slice(...index(old.record.doc).get(C.key([old.record.index,...path]))));if(before!==C.get(current.raw,path))return true;}
   }
   const order=orderPending.at(-1)?.after;return Boolean(order&&(JSON.stringify(order.order)!==JSON.stringify(base.order)||order.sort!==base.sort));
  }
  function orderPatch(after,before){const work=[...after.order],ops=[];for(let i=0;i<before.order.length;i++){const uid=before.order[i];if(work[i]===uid)continue;const from=work.indexOf(uid);if(from>=0){ops.push({op:'move',uid,to:i});work.splice(from,1)}else ops.push({op:'add',uid,to:i});work.splice(i,0,uid)}for(let i=work.length-1;i>=before.order.length;i--){ops.push({op:'remove',uid:work[i]});work.splice(i,1)}return {ops,sort:before.sort,from:hash(JSON.stringify(after)),to:hash(JSON.stringify(before))}}
  function applyOrder(state,delta){if(!delta.ops)return {order:JSON.parse(apply(JSON.stringify(state.order),delta)),sort:'manual'};if(delta.from&&hash(JSON.stringify(state))!==delta.from)throw new Error('顺序历史与当前文件不一致');const order=[...state.order];for(const op of delta.ops){const from=order.indexOf(op.uid);if(op.op==='move'){if(from<0)throw new Error('顺序历史与当前文件不一致');order.splice(from,1);order.splice(op.to,0,op.uid)}else if(op.op==='add'){if(from>=0)throw new Error('顺序历史与当前文件不一致');order.splice(op.to,0,op.uid)}else if(op.op==='remove'){if(from<0)throw new Error('顺序历史与当前文件不一致');order.splice(from,1)}else throw new Error('增量历史格式不受支持')}return {order,sort:delta.sort||state.sort}}
  function recordOrder(before,after){if(data.enabled&&(JSON.stringify(before.order)!==JSON.stringify(after.order)||before.sort!==after.sort)){orderPending.push({after});refreshPositions()}}
  function matchesBefore(raw,delta){
   if(!delta.ops)return typeof raw==='string'&&hash(raw)===delta.to;
   for(const op of delta.ops){
    if(op.op==='insert'){if(raw!==op.raw)return false}
    else if(op.op==='delete'){if(raw!==null)return false}
    else if(op.op==='patch'){if(typeof raw!=='string'||hash(raw)!==op.to)return false}
    else if(op.op==='text'){if(raw===null)return false;const text='['+raw+']',span=C.spans(text,new Set([C.key([0,...op.path])])).get(C.key([0,...op.path]));if(!span||hash(text.slice(...span))!==op.to)return false}
   }return true;
  }
  function open(records,order,saved,settings={}){
   refreshPositions(true);
   if(saved&&![1,141].includes(saved.version))throw new Error('增量历史格式不受支持');if(saved&&(!C.object(saved.records)||!Array.isArray(saved.bindings)||!Array.isArray(saved.orders)))throw new Error('增量历史格式不受支持');data=saved?clone(saved):empty();pending=[];orderPending=[];dirty=Boolean(saved&&saved.version!==141);data.version=141;
   for(const r of records){const binding=data.bindings.find(b=>b.path===r.doc.path&&b.index===r.index&&b.id===(r.id||''))||data.bindings.find(b=>b.path===r.doc.path&&b.id&&(b.id===r.id)&&data.bindings.filter(x=>x.path===r.doc.path&&x.id===r.id).length===1);const matches=Object.entries(data.records).filter(([uid,m])=>m.path===r.doc.path&&m.id&&m.id===r.id);r.historyUid=binding?.uid||(matches.length===1?matches[0][0]:null)||r.historyUid||id();index(r.doc)}
   for(const meta of Object.values(data.records)){meta.versions||=[];if(meta.deleted?.raw){const event={id:id(),time:meta.deleted.time,delta:rawDelta(meta.deleted.raw,null)};meta.versions.push(event);delete meta.deleted.raw;meta.deleted.version=event.id;meta.present=false}else if(meta.present===undefined)meta.present=true}
   // Preserve legacy disabled histories until explicit confirmation clears them.
   needsClearConfirmation=Boolean(saved?.version===1&&!data.enabled&&(Object.keys(data.records).length||data.orders.length));
   base={records:[],fields:new Map(),order:[],sort:settings.sort||'manual'};base=capture(records,order,settings);
   for(const [uid,meta]of Object.entries(data.records)){if(!meta.versions.length)continue;const r=lookup(uid),actual=r?rowRaw(r):null;let valid=true;try{applyEvent(actual,meta.versions.at(-1).delta)}catch(_){valid=false}
    if(!valid){let aligned=false;for(let i=meta.versions.length-1;i>=0;i--)if(matchesBefore(actual,meta.versions[i].delta)){meta.versions=meta.versions.slice(0,i);meta.present=Boolean(r);if(r)delete meta.deleted;dirty=true;aligned=true;break}if(!aligned)meta.conflict=true}
   }
   if(data.orders.length){const current={order:base.order,sort:base.sort};try{applyOrder(current,data.orders.at(-1).delta)}catch(_){let aligned=false;for(let i=data.orders.length-1;i>=0;i--){const delta=data.orders[i].delta;if(delta.to===hash(JSON.stringify(delta.ops?current:current.order))){data.orders=data.orders.slice(0,i);dirty=true;aligned=true;break}}if(!aligned)data.orderConflict=true}}
   return base;
  }
  function prepare(next){
   const candidate={...data,records:{...data.records},orders:[...data.orders]},before=new Map(base.records.map(r=>[r.uid,r])),after=new Map(next.records.map(r=>[r.uid,r])),events=[];
   if(candidate.enabled){
    for(const uid of new Set([...before.keys(),...after.keys()])){const old=before.get(uid),value=after.get(uid);
     let change;if(old&&!value)change=rawDelta(rowRaw(old,true),null);else if(!old&&value)change=rawDelta(null,rowRaw(value));else if(old&&value&&old.record.doc!==value.record.doc){const a=rowRaw(old,true),b=rowRaw(value);if(a!==b)change=rawDelta(a,b)}else if(old&&value){const ops=[];for(const [key,field]of next.fields)if(field.uid===uid){const prior=savedLiteral(old,field.path);if(prior!==field.literal)ops.push(textOp(field.path,prior,field.literal))}if(ops.length)change={ops}}
     if(change)events.push({uid,entry:value||old,id:id(),time:new Date().toISOString(),delta:change,kind:!value?'delete':!old?'insert':'edit'});
    }
    for(const event of events){let meta=candidate.records[event.uid];meta=candidate.records[event.uid]={...(meta||{}),versions:[...(meta?.versions||[])]};meta.versions.push({id:event.id,time:event.time,delta:event.delta,kind:event.kind});meta.path=event.entry.path;meta.index=event.entry.index;meta.id=event.entry.id;meta.title=event.entry.title;delete meta.conflict;
     if(event.kind==='delete')meta.deleted={path:event.entry.path,index:event.entry.index,title:event.entry.title,time:event.time,version:event.id,previous:event.entry.previous,next:event.entry.next,orderIndex:base.order.indexOf(event.uid),orderPrevious:base.order[base.order.indexOf(event.uid)-1]||null,orderNext:base.order[base.order.indexOf(event.uid)+1]||null};else delete meta.deleted;
    }
    for(const [uid,meta]of Object.entries(candidate.records)){const present=after.has(uid);if(meta.present!==present){candidate.records[uid]={...meta,present};if(present)delete candidate.records[uid].deleted}}
    const last={order:base.order,sort:base.sort},current={order:next.order,sort:next.sort};if(JSON.stringify(last)!==JSON.stringify(current))candidate.orders.push({id:id(),time:new Date().toISOString(),delta:orderPatch(current,last)});
   }else{candidate.records={};candidate.orders=[]}
   candidate.bindings=next.records.map(r=>({uid:r.uid,path:r.path,index:r.index,id:r.id}));delete candidate.orderHead;delete candidate.orderConflict;return {data:candidate,snapshot:next,count:pending.length,orderCount:orderPending.length};
  }
  function accept(prepared){refreshPositions(true);data=prepared.data;base=prepared.snapshot;pending.splice(0,prepared.count);orderPending.splice(0,prepared.orderCount);dirty=false}
  function target(uid,version){const meta=data.records[uid];if(!meta)throw new Error('该历史无法与当前资料对应');version=version||meta.deleted?.version;const i=meta.versions.findIndex(v=>v.id===version);if(i<0)throw new Error('版本已不存在');const r=lookup(uid);let raw=r?rowRaw(r,true):null;for(let j=meta.versions.length-1;j>=i;j--)raw=applyEvent(raw,meta.versions[j].delta);return raw}
  function orderStateTarget(version){const i=data.orders.findIndex(v=>v.id===version);if(i<0)throw new Error('顺序版本已不存在');let state={order:base.order,sort:base.sort};for(let j=data.orders.length-1;j>=i;j--)state=applyOrder(state,data.orders[j].delta);return state}
  // Read-only comparison against saved history, never the live unsaved draft.
  function inspect(uid,version){const meta=data.records[uid];if(!meta||meta.conflict)throw new Error('该历史无法与当前资料对应');version=version||meta.deleted?.version;const i=meta.versions.findIndex(v=>v.id===version);if(i<0)throw new Error('版本已不存在');const r=lookup(uid);let raw=r?rowRaw(r,true):null;for(let j=meta.versions.length-1;j>i;j--)raw=applyEvent(raw,meta.versions[j].delta);return {before:applyEvent(raw,meta.versions[i].delta),after:raw}}
  function inspectOrder(version){const i=data.orders.findIndex(v=>v.id===version);if(i<0||data.orderConflict)throw new Error('顺序版本已不存在');return {before:orderStateTarget(version),after:i+1<data.orders.length?orderStateTarget(data.orders[i+1].id):{order:[...base.order],sort:base.sort}}}
  function maintenanceCheckpoint(){return {data:{...data},base,pending:[...pending],orderPending:[...orderPending],dirty,needsClearConfirmation,restored:new Map(restored),restoredOrder}}
  function restoreMaintenance(saved){data=saved.data;base=saved.base;pending=saved.pending;orderPending=saved.orderPending;dirty=saved.dirty;needsClearConfirmation=saved.needsClearConfirmation;restored.clear();for(const [uid,id]of saved.restored)restored.set(uid,id);restoredOrder=saved.restoredOrder;refreshPositions()}
  function acceptMaintenance(){dirty=false;refreshPositions()}
  // Read-only UI position: no cursor, snapshot, or branch is added to disk history.
  function markRestored(uid,version){if(version)restored.set(uid,version);refreshPositions()}
  function markOrderRestored(version){restoredOrder=version;refreshPositions()}
  function position(uid,current){
   const key='record:'+uid,preferred=restored.get(uid),cached=positionCache.get(key);if(cached&&cached.revision===viewRevision&&cached.record===current&&cached.preferred===preferred)return cached.value;
   const meta=data.records[uid],old=lookup(uid);let result;
   try{
    const saved=old?rowRaw(old,true):null,actual=current?rowRaw(current):null,changed=actual!==saved,versions=meta?.versions||[],anchor=versions.findIndex(v=>v.id===preferred);
    result={location:'latest',changed,absent:actual===null,index:-1,version:null};
    if(meta?.conflict)result.location='unavailable';
    else if(changed||anchor>=0){let raw=saved,match=-1;for(let i=versions.length-1;i>=0;i--){raw=applyEvent(raw,versions[i].delta);if(raw===actual&&(match<0||i===anchor))match=i;if(i===anchor&&raw===actual)break;if(anchor<0&&match>=0)break}
     if(!changed&&match!==anchor){/* The draft returned to the saved head. */}
     else if(match>=0)result={...result,location:'history',index:match,version:versions[match].id,exact:true};
     else if(anchor>=0)result={...result,location:'draft',index:anchor,version:versions[anchor].id,exact:false};
     else if(changed)result.location='draft';
    }
   }catch(_){result={location:'unavailable',changed:true,index:-1}}
   positionCache.set(key,{revision:viewRevision,record:current,preferred,value:result});return result;
  }
  function orderPosition(current){
   const key='order',encoded=JSON.stringify(current),cached=positionCache.get(key);if(cached&&cached.revision===viewRevision&&cached.encoded===encoded)return cached.value;
   let result;try{const saved={order:base.order,sort:base.sort},changed=encoded!==JSON.stringify(saved),anchor=data.orders.findIndex(v=>v.id===restoredOrder);result={location:'latest',changed,index:-1,version:null};
    if(data.orderConflict)result.location='unavailable';else if(changed||anchor>=0){let value=saved,match=-1;for(let i=data.orders.length-1;i>=0;i--){value=applyOrder(value,data.orders[i].delta);if(JSON.stringify(value)===encoded&&(match<0||i===anchor))match=i;if(i===anchor&&JSON.stringify(value)===encoded)break;if(anchor<0&&match>=0)break}
     if(!changed&&match!==anchor){/* The draft returned to the saved head. */}
     else if(match>=0)result={...result,location:'history',index:match,version:data.orders[match].id,exact:true};else if(anchor>=0)result={...result,location:'draft',index:anchor,version:data.orders[anchor].id,exact:false};else if(changed)result.location='draft';
    }
   }catch(_){result={location:'unavailable',changed:true,index:-1}}positionCache.set(key,{revision:viewRevision,encoded,value:result});return result;
  }
  function purge(predicate){if(!Object.entries(data.records).some(([uid,m])=>m.deleted&&predicate({kind:'deleted',uid,time:m.deleted.time})||m.versions.some(v=>predicate({kind:'edit',uid,id:v.id,time:v.time})))&&!data.orders.some(v=>predicate({kind:'order',id:v.id,time:v.time})))return;const original=data;data=clone(data);try{
   for(const [uid,meta]of Object.entries(data.records)){
    if(meta.deleted&&predicate({kind:'deleted',uid,time:meta.deleted.time})){delete data.records[uid];continue}
    if(!meta.versions.some(v=>predicate({kind:'edit',uid,id:v.id,time:v.time})))continue;
    const r=lookup(uid);let cursor=r?rowRaw(r,true):null,anchor=cursor,skipped=false;const out=[];
    for(let i=meta.versions.length-1;i>=0;i--){const v=meta.versions[i];cursor=applyEvent(cursor,v.delta);if(predicate({kind:'edit',uid,id:v.id,time:v.time})){skipped=true;continue}out.push(skipped?{...v,delta:rawDelta(cursor,anchor)}:v);anchor=cursor;skipped=false}meta.versions=out.reverse();if(!meta.versions.length)delete data.records[uid];else if(meta.deleted){let state=null,restorable;for(let i=meta.versions.length-1;i>=0;i--){state=applyEvent(state,meta.versions[i].delta);if(state!==null){restorable=meta.versions[i].id;break}}if(restorable)meta.deleted.version=restorable;else delete meta.deleted;}
   }
   let cursor={order:base.order,sort:base.sort},anchor=cursor,skipped=false;const out=[];for(let i=data.orders.length-1;i>=0;i--){const v=data.orders[i];cursor=applyOrder(cursor,v.delta);if(predicate({kind:'order',id:v.id,time:v.time})){skipped=true;continue}out.push(skipped?{...v,delta:orderPatch(anchor,cursor)}:v);anchor=cursor;skipped=false}data.orders=out.reverse();dirty=true;refreshPositions();
   }catch(error){data=original;throw error}
  }
  function setEnabled(value,snapshot){value=Boolean(value);if(value===data.enabled&&!needsClearConfirmation)return;needsClearConfirmation=false;refreshPositions(true);if(!value){data={...empty(),enabled:false,bindings:data.bindings};pending=[];orderPending=[]}else{data.enabled=true;if(snapshot)base=snapshot}dirty=true}
  function clearAll(snapshot,{preservePending=false}={}){refreshPositions(true);if(snapshot)base=snapshot;needsClearConfirmation=false;data={...empty(),enabled:data.enabled,bindings:data.bindings};if(!preservePending){pending=[];orderPending=[]}dirty=true}
  return {capture,open,prepare,accept,target,inspect,inspectOrder,maintenanceCheckpoint,restoreMaintenance,acceptMaintenance,position,orderPosition,markRestored,markOrderRestored,purge,setEnabled,clearAll,documentIndex:index,serializeDocument:doc=>C.patch(doc.text,[...doc.changes.values()],index(doc)),recordFields,recordRaw,recordOrder,rowRaw:r=>rowRaw(r),orderStateTarget,orderTarget:v=>orderStateTarget(v).order,has:uid=>Boolean(data.records[uid]?.versions?.length),get data(){return data},get base(){return base},get maintenanceDirty(){return dirty},get dirty(){return dirty||pendingNet()},get needsClearConfirmation(){return needsClearConfirmation},get pendingCount(){return pending.length+orderPending.length}};
 }
 return {create,delta,apply,materialize,hash};
});
