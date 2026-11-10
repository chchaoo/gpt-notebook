(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_core.js'));else root.ViewerHistory=factory(root.ViewerCore)})(globalThis,function(C){
 'use strict';
 function create(env){
  const log=[],fields=new Map();let savedDeleted=new Set(),savedOrder=[],serial=0,savedApplied=new Set(),savedAt='',destination='打开时的资料';
  const records=()=>env.state.records,record=edit=>records().find(r=>r.doc===edit.doc&&r.index===edit.path[0]);
  function reset(){log.length=0;fields.clear();savedDeleted=new Set(env.state.deleted);savedOrder=[...env.state.order];savedApplied=new Set();savedAt='';destination='打开时的资料';serial=0}
  function track(tx){
   tx.historyId=++serial;tx.historyTime=new Date().toISOString();
   if(Array.isArray(tx))for(const edit of tx){const id=edit.doc.path+'::'+C.key(edit.path);if(!fields.has(id))fields.set(id,{edit,baseline:edit.before,record:record(edit)?.key,node:edit.path[1]==='mapping'?edit.path[2]:null})}
   log.push(tx);return tx;
  }
  function target(tx){if(Array.isArray(tx)){const edit=tx[0];return {record:record(edit)?.key,node:edit?.path[1]==='mapping'?edit.path[2]:null}}return {record:tx.target||tx.keys?.[0],node:null}}
  function label(tx){if(tx.kind==='star')return tx.starred?'添加星标':'取消星标';if(tx.kind==='import')return '增量导入';if(tx.kind==='workspace')return '恢复会话';if(tx.kind==='delete')return '删除 '+tx.keys.length+' 条会话';if(tx.kind==='order')return '调整会话顺序';const edit=tx[0],r=record(edit);return (edit?.path[1]==='title'?'修改标题':'修改消息')+' · '+(r?.raw.title||edit?.doc.path||'')+(tx.length>1?'（'+tx.length+' 个字段）':'')}
  function capture(){return {values:new Map([...fields].map(([id,f])=>[id,C.get(f.edit.doc.data,f.edit.path)])),deleted:new Set(env.state.deleted),order:[...env.state.order],applied:new Set(env.state.undo.map(tx=>tx.historyId))}}
  function markSaved(snapshot=capture(),name='当前资料'){for(const [id,value]of snapshot.values)if(fields.has(id))fields.get(id).baseline=value;savedDeleted=new Set(snapshot.deleted);savedOrder=[...snapshot.order];savedApplied=new Set(snapshot.applied);savedAt=new Date().toISOString();destination=name}
  function rebind(){const values=[...fields.values()];fields.clear();for(const field of values){const r=records().find(r=>r.key===field.record);if(r)field.edit={...field.edit,doc:r.doc,path:[r.index,...field.edit.path.slice(1)]};fields.set(r?r.doc.path+'::'+C.key(field.edit.path):'inactive:'+field.record+'::'+C.key(field.edit.path),field)}}
  function changes(){
   const out=[];for(const field of fields.values()){const value=C.get(field.edit.doc.data,field.edit.path);if(value!==field.baseline)out.push({label:field.node?'修改消息':'修改标题',before:field.baseline,after:value,target:{record:field.record,node:field.node},file:field.edit.doc.path})}
   for(const key of new Set([...savedDeleted,...env.state.deleted]))if(savedDeleted.has(key)!==env.state.deleted.has(key)){const r=records().find(r=>r.key===key);out.push({label:env.state.deleted.has(key)?'删除会话':'恢复会话',before:r?.raw.title||key,after:env.state.deleted.has(key)?'已删除':'已恢复',target:{record:key},file:r?.doc.path||''})}
   if(JSON.stringify(savedOrder)!==JSON.stringify(env.state.order))out.push({label:'调整会话顺序',before:'保存时的排列',after:'当前排列',target:{record:env.state.order[0]},file:'.viewer-state/viewer-settings.json'});return out;
  }
  function status(tx){const applied=env.state.undo.includes(tx),saved=savedApplied.has(tx.historyId);if(!env.unsaved())return applied?'已应用 · 与保存版本一致':'已撤销 · 与保存版本一致';if(applied===saved)return applied?'已保存':'已撤销';return applied?'未保存':'已撤销，尚未保存'}
  return {reset,track,target,label,capture,markSaved,rebind,changes,status,log,info:()=>({savedAt,destination})};
 }
 return {create};
});
