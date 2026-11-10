/* Explicit source binding, conflict checks and recoverable in-place saves. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.ViewerStorage=factory(root.ViewerCore,root.JSZip)})(globalThis,function(C,JSZip){
  'use strict';
  const controls=new Set(['viewer-history.json','viewer-settings.json']);
  const segment=path=>/^\.viewer-backups\/segments\/[a-z0-9-]+\.json$/.test(path);
  const backupPath=path=>C.validPath(path)&&path.startsWith('.viewer-backups/');
  const oldControl=path=>controls.has(path)||['.viewer-backups/viewer-history.json','.viewer-backups/viewer-settings.json'].includes(path);
  const hidden=path=>{const parts=path.split('/');if(parts.some(p=>p==='__MACOSX'||p==='.DS_Store'))return true;let i=parts.indexOf('.viewer-state');if(i>=0)return !(i===parts.length-1||i===parts.length-2&&controls.has(parts.at(-1)));i=parts.indexOf('.viewer-backups');return i>=0&&!(i===parts.length-1||i===parts.length-2&&controls.has(parts.at(-1))||parts.slice(i).join('/')==='.viewer-backups/segments'||segment(parts.slice(i).join('/')))};
  const valid=path=>C.validPath(path)&&!hidden(path)&&!['.viewer-backups','.viewer-state','.viewer-backups/segments'].includes(path);
  const metadataPath=path=>C.validPath(path)&&(path.startsWith('.viewer-state/')||backupPath(path));
  async function backupFiles(handle,name='.viewer-backups'){
    let folder;try{folder=await handle.getDirectoryHandle(name)}catch(error){if(error.name==='NotFoundError')return [];throw error}const files=[];
    async function walk(dir,prefix){for await(const child of dir.values()){const path=prefix+'/'+child.name;if(!metadataPath(path))throw new Error('保存路径无效');if(child.kind==='directory')await walk(child,path);else files.push({path,blob:await child.getFile()})}}
    await walk(folder,name);return files;
  }
  async function pruneEmptyBackupFolders(handle,name='.viewer-backups',strict=false){
    const failed=[];async function visit(parent,name,path){let dir;try{dir=await parent.getDirectoryHandle(name)}catch(error){if(error.name==='NotFoundError')return;failed.push(path);return}try{for await(const child of dir.values())if(child.kind==='directory')await visit(dir,child.name,path+'/'+child.name);for await(const child of dir.values()){if(strict)failed.push(path);return}await parent.removeEntry(name)}catch(_){failed.push(path)}}
    await visit(handle,name,name);return failed;
  }
  async function digest(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(globalThis.crypto?.subtle){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
    return bytes.length+':'+C.crc32(bytes).toString(16);
  }
  async function baseline(entries){const out=new Map();for(const entry of entries)out.set(entry.path,await digest(entry.blob));return out}
  async function directory(handle){
    const entries=[];
    async function walk(dir,prefix){for await(const child of dir.values()){
      const path=prefix+child.name;if(hidden(path))continue;if(!C.validPath(path))throw new Error('目录中存在无效路径：'+path);
      if(child.kind==='directory')await walk(child,path+'/');else entries.push({path,blob:await child.getFile()});
    }}
    await walk(handle,'');return {entries,source:{kind:'directory',handle,name:handle.name,baseline:await baseline(entries)}};
  }
  async function readonly(entries,name=''){return {kind:'directory-readonly',name,baseline:await baseline(entries)}}
  function inspectZip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===bytes.length){end=p;break}
    if(end<0)throw new Error('ZIP 文件不完整或格式不受支持');
    const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);
    if(count===65535||offset===0xffffffff)throw new Error('此版本暂不支持 ZIP64');
    if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('不支持分卷 ZIP');
    let p=offset,total=0;const seen=new Set();
    for(let i=0;i<count;i++){
      if(p+46>end||view.getUint32(p,true)!==0x02014b50)throw new Error('ZIP 目录损坏');
      const flags=view.getUint16(p+8,true),size=view.getUint32(p+24,true),length=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);
      if(flags&1)throw new Error('请先解密 ZIP 文件');
      if(size===0xffffffff||size>512*1024*1024||(total+=size)>1024*1024*1024)throw new Error('ZIP 解压体积超出本版本限制');
      if(p+46+length+extra+comment>end)throw new Error('ZIP 目录长度无效');
      const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(p+46,p+46+length)).replace(/\/$/,'');
      if(!C.validPath(name))throw new Error('ZIP 包含不安全路径：'+name);
      const identity=name.normalize('NFC').toLowerCase();if(seen.has(identity))throw new Error('ZIP 中存在重复或大小写冲突路径：'+name);seen.add(identity);
      p+=46+length+extra+comment;
    }
  }
  async function zip(blob,handle=null,progress=()=>{}){
    progress('校验 ZIP',null);
    const bytes=new Uint8Array(await blob.arrayBuffer());inspectZip(bytes);
    const archive=await JSZip.loadAsync(bytes,{checkCRC32:true,createFolders:false});
    const files=Object.values(archive.files).filter(f=>!f.dir&&!hidden(f.name));
    for(const file of files)if(!C.validPath(file.name)||file.unsafeOriginalName&&file.unsafeOriginalName!==file.name)throw new Error('ZIP 原始路径无效');
    let prefix='';const first=files[0]?.name.split('/')[0];
    if(first&&files.every(f=>f.name.startsWith(first+'/')))prefix=first+'/';
    const entries=[];
    for(const [i,file]of files.entries()){const path=file.name.slice(prefix.length);if(!valid(path))continue;entries.push({path,blob:new Blob([await file.async('uint8array',meta=>progress('读取 ZIP',(i+meta.percent/100)/files.length*100))])})}
    progress('读取 ZIP',100);
    return {entries,source:{kind:'zip',handle,name:blob.name||handle?.name||'ChatGPT.zip',prefix,zip:archive,zipDigest:await digest(blob),baseline:await baseline(entries)}};
  }
  async function permission(handle){
    if(!handle)return;
    if(handle.queryPermission&&await handle.queryPermission({mode:'readwrite'})!=='granted'){
      if(!handle.requestPermission||await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('没有获得写入权限，修改仍保留在草稿中');
    }
  }
  async function fileAt(root,path,create=false){
    if(!C.validPath(path))throw new Error('保存路径无效');const parts=path.split('/');let dir=root;
    for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create});
    return {parent:dir,name:parts.at(-1),handle:await dir.getFileHandle(parts.at(-1),{create})};
  }
  async function maybeFile(root,path){try{return await fileAt(root,path)}catch(error){if(error.name==='NotFoundError')return null;throw error}}
  async function writeChunks(stream,blob,onBytes=()=>{}){
    const size=blob.size,step=4*1024*1024;onBytes(0);if(!size){await stream.write(blob);return}
    for(let offset=0;offset<size;offset+=step){const end=Math.min(size,offset+step);await stream.write(blob.slice(offset,end));onBytes(end)}
  }
  async function write(handle,blob,progress=()=>{}){const stream=await handle.createWritable({mode:'exclusive'});try{await writeChunks(stream,blob,bytes=>progress('写入 ZIP',blob.size?bytes/blob.size*100:100));progress('提交文件',null);await stream.close()}catch(error){try{await stream.abort?.()}catch(_){}throw error}}
  async function bindDirectory(source,handle){
    const found=await directory(handle);
    for(const [path,hash]of source.baseline||[])if(found.source.baseline.get(path)!==hash)throw new Error('所选目录与打开时的数据不一致，已停止保存；请选择原目录或另存为');
    return found.source;
  }
  async function bindZip(source,handle){
    const file=await handle.getFile();if(await digest(file)!==source.zipDigest)throw new Error('所选 ZIP 与打开时不一致，已停止保存');
    return {...source,handle,name:handle.name};
  }
  async function zipBlob(source,entries,progress=()=>{}){
    progress('准备 ZIP',null);
    const output=source?.kind==='zip'&&source.zip?await JSZip.loadAsync(await source.zip.generateAsync({type:'uint8array'},meta=>progress('准备 ZIP',meta.percent))):new JSZip();
    if(entries.clearMetadata)output.remove((source?.prefix||'')+'.viewer-state/');
    if(entries.clearBackupFolder||entries.clearMetadata)output.remove((source?.prefix||'')+'.viewer-backups/');
    for(const path of entries.removedPaths||[])output.remove((source?.prefix||'')+path);
    for(const [i,entry]of entries.entries()){if(!valid(entry.path))throw new Error('保存路径无效');output.file((source?.prefix||'')+entry.path,new Uint8Array(await entry.blob.arrayBuffer()));progress('整理文件',(i+1)/entries.length*100)}
    if(Object.keys(output.files).length>=65535)throw new Error('文件数量超出普通 ZIP 限制，请改存目录');
    return new Blob([await output.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}},meta=>progress('压缩 ZIP',meta.percent))],{type:'application/zip'});
  }
  async function saveZip(source,entries,handle=source.handle,asNew=false,progress=()=>{}){
    progress('检查保存目标',null);
    if(!handle)throw new Error('尚未获得原 ZIP 的写入句柄');await permission(handle);
    if(!asNew&&await digest(await handle.getFile())!==source.zipDigest)throw new Error('原 ZIP 在其他程序中已修改，请重新打开或另存为');
    const blob=await zipBlob(source,entries,progress);if(!asNew&&await digest(await handle.getFile())!==source.zipDigest)throw new Error('原 ZIP 在其他程序中已修改，请重新打开或另存为');progress('写入 ZIP',null);await write(handle,blob,progress);progress('校验保存结果',null);
    const result={...source,kind:'zip',handle,name:handle.name,prefix:source?.prefix||'',zip:await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer())),zipDigest:await digest(blob),baseline:await baseline(entries)};progress('保存完成',100);return result;
  }
  async function saveDirectory(source,entries,options={}){
    const progress=options.progress||(()=>{});progress('检查文件',null);await permission(source.handle);const changes=[],hashes=new Map(source.baseline),opened=[],committed=[];
    const candidates=entries.filter(entry=>!options.paths||options.paths.has(entry.path));
    for(const [index,entry]of candidates.entries()){progress('检查文件',candidates.length?index/candidates.length*100:100);if(!valid(entry.path))throw new Error('保存路径无效');const old=await maybeFile(source.handle,entry.path),blob=old?await old.handle.getFile():null,found=blob?await digest(blob):null,next=await digest(entry.blob);hashes.set(entry.path,next);if(found===next)continue;if(found!==(source.baseline.get(entry.path)||null))throw new Error('源文件在其他程序中已修改：'+entry.path);changes.push({...entry,old,before:blob,restore:options.rollback?.get(entry.path),found})}
    progress('检查文件',100);
    const removePaths=new Set(options.removePaths||[]);if(options.clearBackupFolder)for(const entry of await backupFiles(source.handle))removePaths.add(entry.path);
    if(options.clearMetadata)for(const name of ['.viewer-state','.viewer-backups'])for(const entry of await backupFiles(source.handle,name))removePaths.add(entry.path);
    for(const path of removePaths){if(!(options.clearMetadata&&metadataPath(path))&&!oldControl(path)&&!segment(path)&&!(options.clearBackupFolder&&backupPath(path)))throw new Error('保存路径无效');const old=await maybeFile(source.handle,path);if(!old){if(source.baseline.has(path))throw new Error('源文件在其他程序中已修改：'+path);continue}const before=await old.handle.getFile(),found=await digest(before);if(found!==source.baseline.get(path)&&!((options.clearMetadata&&metadataPath(path)||options.clearBackupFolder&&backupPath(path))&&!source.baseline.has(path)))throw new Error('源文件在其他程序中已修改：'+path);const restore=options.rollback?.get(path),snapshot=restore?before:new Blob([await before.arrayBuffer()]);changes.push({path,old,before:snapshot,found,remove:true,restore});hashes.delete(path)}
    // Commit the small reverse-delta journal first. Individual file writes use
    // the browser's atomic writer; normal errors roll back from RAM only.
    const priority=e=>segment(e.path)?0:e.path==='.viewer-state/viewer-history.json'?1:2;changes.sort((a,b)=>priority(a)-priority(b));
    const totalBytes=changes.filter(e=>!e.remove).reduce((sum,e)=>sum+e.blob.size,0);let writtenBytes=0,submitted=0;
    try{
      progress('写入文件',0);
      for(const entry of changes){if(entry.remove)continue;const target=entry.old||await fileAt(source.handle,entry.path,true),item={entry,target};opened.push(item);item.stream=await target.handle.createWritable({mode:'exclusive'});await writeChunks(item.stream,entry.blob,bytes=>progress('写入文件',totalBytes?(writtenBytes+bytes)/totalBytes*100:100));writtenBytes+=entry.blob.size}
      progress('检查提交',null);
      for(const e of changes)if(e.old&&await digest(await e.old.handle.getFile())!==e.found)throw new Error('提交前源文件再次变化：'+e.path);
      progress('提交文件',0);
      for(const item of opened){await item.stream.close();committed.push(item);progress('提交文件',++submitted/changes.length*100)}
      for(const entry of changes.filter(e=>e.remove)){await entry.old.parent.removeEntry(entry.old.name);committed.push({entry,target:entry.old,removed:true});progress('提交文件',++submitted/changes.length*100)}
      if(options.clearMetadata){
        for(const name of ['.viewer-state','.viewer-backups']){
          const failures=await pruneEmptyBackupFolders(source.handle,name,true);
          if(failures.length)throw new Error('无法移除查看器目录：'+name);
        }
      }
    }catch(error){
      progress('回滚文件',null);
      let failed=false;for(const item of opened)try{await item.stream?.abort?.()}catch(_){}
      for(const item of committed.reverse())try{if(item.removed)item.target=await fileAt(source.handle,item.entry.path,true);if(item.entry.restore)await write(item.target.handle,await item.entry.restore());else if(item.entry.before)await write(item.target.handle,item.entry.before);else await item.target.parent.removeEntry(item.target.name)}catch(_){failed=true}
      for(const item of opened)if(!item.entry.before&&!committed.includes(item))try{await item.target.parent.removeEntry(item.target.name)}catch(_){}
      if(failed){for(const entry of changes.filter(e=>segment(e.path)&&!e.remove))try{await write((await fileAt(source.handle,entry.path,true)).handle,entry.blob)}catch(_){}const ledger=changes.find(e=>e.path==='.viewer-state/viewer-history.json');if(ledger)try{await write((await fileAt(source.handle,ledger.path,true)).handle,ledger.blob)}catch(_){} }
      throw new Error('保存失败，'+(failed?'部分回滚失败，请保留当前页面并检查原目录。':'已回滚本次文件修改。')+error.message);
    }
    progress('整理文件',null);
    const cleanupFailures=!options.clearMetadata&&(options.clearBackupFolder||changes.some(e=>e.remove&&backupPath(e.path)))?await pruneEmptyBackupFolders(source.handle):[];progress('保存完成',100);return {source:{...source,baseline:hashes},backup:null,written:changes.length,cleanupFailures};
  }
  async function exportDirectory(handle,entries){
    await permission(handle);
    for await(const child of handle.values())throw new Error('导出文件夹必须为空，请选择或新建一个空目录');
    const seen=new Set();for(const entry of entries){if(!valid(entry.path)||seen.has(entry.path.toLowerCase()))throw new Error('导出路径无效或重复：'+entry.path);seen.add(entry.path.toLowerCase())}
    const created=[];
    try{
      for(const entry of entries){if(await maybeFile(handle,entry.path))throw new Error('目标目录中出现了同名文件，已停止导出');const target=await fileAt(handle,entry.path,true);created.push(target);await write(target.handle,entry.blob)}
    }catch(error){
      let incomplete=false;for(const item of created.reverse())try{await item.parent.removeEntry(item.name)}catch(_){incomplete=true}
      throw new Error('文件夹导出失败；'+(incomplete?'部分输出未能清理，请检查目标目录。':'已清理本次创建的文件。')+error.message);
    }
  }
  return {hidden,valid,backupFiles,pruneEmptyBackupFolders,digest,baseline,directory,readonly,inspectZip,zip,permission,bindDirectory,bindZip,zipBlob,saveZip,saveDirectory,write,exportDirectory};
});
