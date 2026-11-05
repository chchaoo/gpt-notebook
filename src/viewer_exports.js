(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_core.js'));else root.ViewerExports=factory(root.ViewerCore)})(globalThis,function(C){
  'use strict';
  function filename(value,fallback='未命名聊天'){
    let name=String(value||fallback).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim();
    name=name.slice(0,80).replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'');if(!name)name=fallback;
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
    return name;
  }
  function unique(name,used){let result=name,n=2;while(used.has(result.toLocaleLowerCase()))result=name+' ('+n+++')';used.add(result.toLocaleLowerCase());return result}
  function selectedJSON(records){
    const cache=new Map(),output=[];
    for(const r of records){
      if(!cache.has(r.doc)){
        const raw=C.serialize(r.doc),indices=records.filter(x=>x.doc===r.doc).map(x=>C.key([x.index]));
        cache.set(r.doc,{raw,spans:C.spans(raw,new Set(indices))});
      }
      const {raw,spans}=cache.get(r.doc),span=spans.get(C.key([r.index]));
      if(!span)throw new Error('找不到所选会话的原始数据');output.push(raw.slice(span[0],span[1]));
    }
    return '[\n'+output.join(',\n')+'\n]';
  }
  function selectIndices(doc,indices){const raw=C.serialize(doc),spans=C.spans(raw,new Set(indices.map(i=>C.key([i]))));return '[\n'+indices.map(i=>{const s=spans.get(C.key([i]));if(!s)throw new Error('会话索引不存在');return raw.slice(s[0],s[1])}).join(',\n')+'\n]'}
  async function base64(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.slice(i,i+32768));
    return btoa(binary);
  }
  async function payload(records,resources){
    const raw=selectedJSON(records),archive=[],names={},seen=new Set();
    for(const [id,entry]of resources){
      if(!raw.includes(id)||seen.has(entry.path))continue;seen.add(entry.path);
      archive.push({path:entry.path,mime:entry.mime||entry.blob.type||'application/octet-stream',base64:await base64(entry.blob)});
      if(entry.name)names[entry.path.split('/').pop()]=entry.name;
    }
    archive.push({path:'conversation_asset_file_names.json',mime:'application/json',base64:await base64(new Blob([JSON.stringify(names)]))});
    const settings={version:1,sort:'manual',order:records.map((r,index)=>({id:r.id||r.raw.id||'',path:'conversations.json',index}))};
    archive.push({path:'.viewer-state/viewer-settings.json',mime:'application/json',base64:await base64(new Blob([JSON.stringify(settings)]))});
    return {version:2,sources:[{path:'conversations.json',text:raw}],archive};
  }
  async function bundle(records,resources,shell){
    if(!records.length)throw new Error('请先选择聊天记录');
    const data=await payload(records,resources),groups=new Map(),entries=new Map();
    function add(path,blob){if(!C.validPath(path)||entries.has(path))throw new Error('导出路径无效或重复：'+path);entries.set(path,{path,blob})}
    for(const r of records){if(!groups.has(r.doc))groups.set(r.doc,[]);groups.get(r.doc).push(r)}
    data.sources=[...groups].map(([doc,rows])=>({path:doc.path||'conversations.json',text:selectedJSON(rows)}));
    const order=records.map(r=>({id:r.id||r.raw.id||'',path:r.doc.path||'conversations.json',index:groups.get(r.doc).indexOf(r)}));
    // Build a new archive; never carry over unselected conversations, global
    // account files, old chat.html, or unused members from the source ZIP.
    data.archive=data.archive.filter(item=>item.path!=='.viewer-state/viewer-settings.json');
    data.archive.push({path:'.viewer-state/viewer-settings.json',mime:'application/json',base64:await base64(new Blob([JSON.stringify({version:1,sort:'manual',order})]))});
    for(const source of data.sources)add(source.path,new Blob([source.text],{type:'application/json'}));
    for(const item of data.archive){const bytes=Uint8Array.from(atob(item.base64),ch=>ch.charCodeAt(0));add(item.path,new Blob([bytes],{type:item.mime}))}
    add('chat.html',new Blob([html(shell,data)],{type:'text/html'}));
    const files=[...entries.values()].filter(e=>!e.path.startsWith('.viewer-backups/')&&!e.path.startsWith('.viewer-state/')).map(e=>({path:e.path,size_bytes:e.blob.size}));
    const logical_files={'conversations.json':{files:data.sources.map(s=>s.path),sharded:data.sources.length>1}};
    for(const item of files)if(!data.sources.some(s=>s.path===item.path))logical_files[item.path]={files:[item.path],sharded:false};
    add('export_manifest.json',new Blob([JSON.stringify({export_files:files,logical_files},null,2)],{type:'application/json'}));
    return [...entries.values()];
  }
  function html(shell,data){
    const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    let replaced=false;
    const result=shell.replace(/(<script\b[^>]*\bid=["']data["'][^>]*>)[\s\S]*?(<\/script>)/i,(_,a,b)=>{replaced=true;return a+json+b});
    if(!replaced)throw new Error('无法找到独立 HTML 的数据容器');return result;
  }
  const extension=mime=>({'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','image/bmp':'.bmp','audio/mpeg':'.mp3','audio/wav':'.wav','audio/ogg':'.ogg','audio/mp4':'.m4a','video/mp4':'.mp4','application/pdf':'.pdf'})[mime]||'.bin';
  const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
  function imageFromData(value){
    const match=/^data:(image\/(?:png|jpeg|gif|webp|avif|bmp));base64,([A-Za-z0-9+/=]+)$/.exec(value);if(!match)return null;
    const binary=atob(match[2]),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));return new Blob([bytes],{type:match[1]});
  }
  async function markdown(records,resources,options={}){
    const media=[],documents=[],usedTitles=new Set();
    for(const r of records){
      const name=unique(filename(r.raw.title),usedTitles),sections=['# '+(r.raw.title||'未命名聊天')],assetNames=new Set(),assetPaths=new Map();
      async function include(id,blob,suggested,mime){
        if(assetPaths.has(id))return assetPaths.get(id);
        let file=filename(suggested||id);if(/\.dat$/i.test(file)||!file.includes('.'))file=file.replace(/\.dat$/i,'')+extension(mime);
        const extensionAt=file.lastIndexOf('.'),stem=extensionAt>0?file.slice(0,extensionAt):file,ext=extensionAt>0?file.slice(extensionAt):'';
        let candidate=file,n=2;while(assetNames.has(candidate.toLowerCase()))candidate=stem+' ('+n+++')'+ext;file=candidate;assetNames.add(file.toLowerCase());const path='media/'+name+'/'+file;
        media.push({path,blob});assetPaths.set(id,path);return path;
      }
      async function embeddedImages(value){
        const regex=/!\[[^\]]*\]\(\s*(data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+)\s*\)/g;
        const substitutions=[];let m,i=0;
        while((m=regex.exec(value))){const blob=imageFromData(m[1]);if(!blob)continue;const path=await include(m[1],blob,'插入图片-'+(++i)+extension(blob.type),blob.type);substitutions.push([m.index,m.index+m[0].length,'![插入图片]('+encodePath(path)+')'])}
        for(const [start,end,text]of substitutions.reverse())value=value.slice(0,start)+text+value.slice(end);
        return value;
      }
      for(const id of C.branch(r.raw,options.allBranches?'__all__':options.branches?.get(r.key)).ids){
        const message=C.nodeMap(r.raw)[id]?.message;if(!C.object(message))continue;
        const info=C.classification(message);if(info.thought&&!options.thoughts||info.tool&&!options.tools)continue;
        sections.push('## '+(( {user:'用户',assistant:'助手',tool:'工具',system:'系统',developer:'系统'})[info.role]||info.role));
        for(const block of C.blocks(message)){
          if(block.type==='markdown')sections.push(await embeddedImages(block.text.replace(/^:::writing\{[^\n]*\}\s*\n([\s\S]*?)(?:\n:::\s*$|$)/gm,'$1')));
          else if(block.type==='raw')sections.push('```json\n'+block.text+'\n```');
          else if(block.type==='link')sections.push('['+block.text+']('+block.url+')');
          else if(block.type==='asset'){
            const entry=resources.get(block.id);if(!entry){sections.push('附件缺失：'+(block.name||block.id));continue}
            const resolved=options.resolveResource?await options.resolveResource(entry,block.name||entry.name,block.mime):{blob:entry.blob,mime:block.mime||entry.mime||entry.blob.type};
            const path=await include(block.id,resolved.blob,block.name||entry.name||entry.path.split('/').pop(),resolved.mime),label=(block.name||entry.name||'附件').replace(/[\[\]]/g,'');
            sections.push((/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(resolved.mime)?'!':'')+'['+label+']('+encodePath(path)+')');
          }
        }
      }
      documents.push({name,text:sections.join('\n\n')+'\n'});
    }
    const entries=options.combined?[{path:filename(options.name||'聊天记录')+'.md',blob:new Blob([documents.map(d=>d.text).join('\n\n---\n\n')],{type:'text/markdown'})}]:documents.map(d=>({path:d.name+'.md',blob:new Blob([d.text],{type:'text/markdown'})}));
    return [...entries,...media];
  }
  return {filename,unique,selectedJSON,selectIndices,payload,bundle,html,markdown,base64};
});
