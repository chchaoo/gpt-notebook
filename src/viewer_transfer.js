(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ViewerTransfer=factory()})(globalThis,function(){
  'use strict';
  // Capture all handles inside the drop event, before its first await. Browsers
  // revoke DataTransfer access after that event's synchronous dispatch finishes.
  function capture(data){
    const items=Array.from(data.items||[]).filter(i=>i.kind==='file'||!i.kind);
    const handles=items.map(item=>{try{return item.getAsFileSystemHandle?item.getAsFileSystemHandle().catch(()=>null):Promise.resolve(null)}catch(_){return Promise.resolve(null)}});
    const legacy=items.map(item=>{try{return item.webkitGetAsEntry?item.webkitGetAsEntry():null}catch(_){return null}}).filter(Boolean);
    return {handles,legacy,files:Array.from(data.files||[])};
  }
  async function read(captured){
    const handles=(await Promise.all(captured.handles)).filter(Boolean),entries=[];
    async function modern(handle,path){
      if(handle.kind==='file')entries.push({path,blob:await handle.getFile()});
      else for await(const child of handle.values())await modern(child,path?path+'/'+child.name:child.name);
    }
    async function legacy(entry,path){
      if(entry.isFile){const blob=await new Promise((resolve,reject)=>entry.file(resolve,reject));entries.push({path,blob})}
      else if(entry.isDirectory){const reader=entry.createReader();while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await legacy(child,path?path+'/'+child.name:child.name)}}
    }
    let failure;
    if(handles.length===captured.handles.length&&handles.length){try{for(const h of handles)await modern(h,handles.length===1&&h.kind==='directory'?'':h.name);return entries}catch(error){failure=error;entries.length=0}}
    if(captured.legacy.length){try{for(const entry of captured.legacy)await legacy(entry,captured.legacy.length===1&&entry.isDirectory?'':entry.name);return entries}catch(error){failure=error;entries.length=0}}
    const files=captured.files.filter(file=>file.name&&(!failure||file.size>0));
    if(files.length){for(const blob of files){const parts=(blob.webkitRelativePath||blob.name).split('/');entries.push({path:parts.length>1?parts.slice(1).join('/'):parts[0],blob})}return entries}
    throw new Error('浏览器未能读取拖入的目录，请点击“选择导出目录”继续。'+(failure?'（'+failure.message+'）':''));
  }
  return {capture,read};
});
