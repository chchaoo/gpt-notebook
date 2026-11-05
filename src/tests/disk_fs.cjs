// File System Access adapter backed by actual files in an isolated test folder.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function diskFS(t,initial={}){
 const parent=await fs.realpath(__dirname),root=await fs.mkdtemp(path.join(parent,'tmp-native-')),control={},calls=[];
 function absolute(relative=''){const value=path.resolve(root,...relative.split('/'));if(value!==root&&!value.startsWith(root+path.sep))throw Error('outside test disk');return value}
 t.after(async()=>{const target=path.resolve(root);if(path.dirname(target)!==parent||!path.basename(target).startsWith('tmp-native-')||await fs.realpath(target)!==target)throw Error('unsafe test cleanup');await fs.rm(target,{recursive:true,force:true})});
 const fail=(phase,p)=>{const error=control.fail?.(phase,p);if(error)throw error};
 const normalize=error=>{if(error.code==='ENOENT')error.name='NotFoundError';throw error};
 for(const [name,value]of Object.entries(initial)){await fs.mkdir(path.dirname(absolute(name)),{recursive:true});await fs.writeFile(absolute(name),value)}
 function file(p){return {kind:'file',name:path.basename(p),absolute:absolute(p),async queryPermission(){return 'granted'},async requestPermission(){return 'granted'},async isSameEntry(other){return other.absolute===absolute(p)},
  async getFile(){try{const blob=new Blob([await fs.readFile(absolute(p))]);Object.defineProperty(blob,'name',{value:path.basename(p)});calls.push(['read',p]);return blob}catch(e){normalize(e)}},
  async createWritable(){fail('open',p);const temp=absolute(p)+'.'+crypto.randomUUID()+'.tmp';let open=true;calls.push(['open',p]);return {async write(blob){fail('write',p);await fs.writeFile(temp,new Uint8Array(await blob.arrayBuffer()))},async close(){fail('close',p);await fs.rename(temp,absolute(p));open=false;calls.push(['close',p])},async abort(){if(open)await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e});open=false}}}
 }}
 function directory(p=''){const join=name=>p?p+'/'+name:name;return {kind:'directory',name:path.basename(p||root),async queryPermission(){return 'granted'},async requestPermission(){return 'granted'},
  async *values(){let rows;try{rows=await fs.readdir(absolute(p),{withFileTypes:true})}catch(e){normalize(e)}for(const row of rows){if(row.isSymbolicLink())throw Error('symlink in test disk');yield row.isDirectory()?directory(join(row.name)):file(join(row.name))}},
  async getDirectoryHandle(name,{create=false}={}){const q=join(name);try{if(create)await fs.mkdir(absolute(q),{recursive:false}).catch(e=>{if(e.code!=='EEXIST')throw e});if(!(await fs.stat(absolute(q))).isDirectory())throw Error('not a directory');return directory(q)}catch(e){normalize(e)}},
  async getFileHandle(name,{create=false}={}){const q=join(name);try{if(create)await fs.writeFile(absolute(q),'',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});if(!(await fs.stat(absolute(q))).isFile())throw Error('not a file');return file(q)}catch(e){normalize(e)}},
  async removeEntry(name){const q=join(name);fail('remove',q);try{const info=await fs.lstat(absolute(q));if(info.isSymbolicLink())throw Error('symlink removal rejected');if(info.isDirectory())await fs.rmdir(absolute(q));else await fs.unlink(absolute(q));calls.push(['remove',q])}catch(e){normalize(e)}}
 }}
 async function contents(){const result=new Map();async function visit(p=''){for(const row of await fs.readdir(absolute(p),{withFileTypes:true})){const q=p?p+'/'+row.name:row.name;if(row.isDirectory())await visit(q);else result.set(q,await fs.readFile(absolute(q)))}}await visit();return result}
 return {root:directory(),directory:root,control,calls,contents,read:p=>fs.readFile(absolute(p),'utf8'),exists:async p=>fs.stat(absolute(p)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e}),put:async(p,data)=>{await fs.mkdir(path.dirname(absolute(p)),{recursive:true});await fs.writeFile(absolute(p),data)}};
}
module.exports={diskFS};
