// Browser File System Access contract mock: writes become visible on close.
function memoryFS(initial={},name='archive'){
 const files=new Map(Object.entries(initial).map(([p,v])=>[p,new Blob([v])])),dirs=new Set(['']),calls=[],control={};
 for(const path of files.keys()){const parts=path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'))}
 const missing=()=>Object.assign(new Error('not found'),{name:'NotFoundError'});
 const fail=(phase,path)=>{const error=control.fail?.(phase,path);if(error)throw error};
 function file(path){return {kind:'file',name:path.split('/').at(-1),path,
  async getFile(){if(!files.has(path))throw missing();const copy=new Blob([await files.get(path).arrayBuffer()]);Object.defineProperty(copy,'name',{value:this.name});return copy},
  async queryPermission(){return control.denied?'denied':'granted'},async requestPermission(){return control.denied?'denied':'granted'},
  async isSameEntry(other){return other?.path===path&&other?.memory===files},memory:files,
  async createWritable(){fail('open',path);calls.push(['open',path]);let pending;const chunks=[];
   return {async write(blob){fail('write',path);chunks.push(await blob.arrayBuffer());pending=new Blob(chunks)},async close(){fail('close',path);files.set(path,pending);calls.push(['close',path])},async abort(){calls.push(['abort',path])}}}
 }}
 function directory(prefix=''){return {kind:'directory',name:prefix.split('/').at(-1)||name,
  async queryPermission(){return control.denied?'denied':'granted'},async requestPermission(){return control.denied?'denied':'granted'},
  async *values(){const seen=new Set(),start=prefix?prefix+'/':'';for(const path of [...dirs,...files.keys()]){if(!path.startsWith(start)||path===prefix)continue;const child=path.slice(start.length).split('/')[0];if(seen.has(child))continue;seen.add(child);const full=start+child;yield dirs.has(full)?directory(full):file(full)}},
  async getDirectoryHandle(child,options={}){const path=(prefix?prefix+'/':'')+child;if(!dirs.has(path)){if(!options.create)throw missing();dirs.add(path)}return directory(path)},
  async getFileHandle(child,options={}){const path=(prefix?prefix+'/':'')+child;if(!files.has(path)){if(!options.create)throw missing();files.set(path,new Blob([]))}return file(path)},
  async removeEntry(child,options={}){const target=(prefix?prefix+'/':'')+child;fail('remove',target);if(dirs.has(target)){if(!options.recursive&&[...files.keys(),...dirs].some(p=>p.startsWith(target+'/')))throw new Error('Directory is not empty');for(const p of [...files.keys()])if(p.startsWith(target+'/'))files.delete(p);for(const p of [...dirs])if(p===target||p.startsWith(target+'/'))dirs.delete(p)}else files.delete(target)}
 }}
 return {root:directory(),files,dirs,file,calls,control};
}
module.exports={memoryFS};
