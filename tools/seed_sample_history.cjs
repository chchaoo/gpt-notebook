// Public fictional samples only. No user-selected paths or exports are read.
const fs=require('node:fs'),path=require('node:path');
const C=require('../src/viewer_core.js'),J=require('../src/viewer_journal.js'),S=require('../src/viewer_journal_store.js');
// Stable fictional timestamps and IDs make the example ZIPs reproducible.
const RealDate=Date;let tick=0,randomSeed=12345;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[1780272000000+tick++*60000]))}static now(){return 1780272000000+tick++*60000}};
Math.random=()=>((randomSeed=(randomSeed*16807)%2147483647)-1)/2147483646;
(async()=>{
 const folder=path.resolve(process.argv[2]),zh=process.argv[3]==='zh-CN';
 const expected=path.resolve(__dirname,'../.validation',zh?'zh-CN':'en','sample-archive');
 if(folder!==expected)throw new Error('Samples must stay in the generated validation folder');
 const segments=path.join(folder,'.viewer-backups/segments');
 if(fs.existsSync(segments))for(const name of fs.readdirSync(segments)){
  const file=path.join(segments,name);
  if(!/^[a-z0-9-]+\.json$/.test(name)||!fs.lstatSync(file).isFile())throw new Error('Unexpected sample segment');
  fs.unlinkSync(file);
 }
 const doc=C.document(fs.readFileSync(path.join(folder,'conversations.json'),'utf8'));doc.path='conversations.json';
 const records=doc.data.map((raw,index)=>({doc,index,raw,id:raw.id,key:String(index)}));
 const j=J.create(),order=records.map(r=>r.key),title=doc.data[0].title;
 C.change(doc,[0,'title'],zh?'周末计划':'Weekend plan');
 const field=[0,'mapping','a','message','content','parts',0],answer=doc.data[0].mapping.a.message.content.parts[0];
 C.change(doc,field,zh?'周六读书，周日写笔记。':'Read on Saturday. Write notes on Sunday.');
 j.open(records,order,null);
 function save(){j.accept(j.prepare(j.capture(records,order)))}
 C.change(doc,[0,'title'],title);save();
 C.change(doc,field,answer);save();
 for(const entry of S.create().prepare(j.data).entries){
  const target=path.join(folder,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(await entry.blob.arrayBuffer()));
 }
 fs.writeFileSync(path.join(folder,'conversations.json'),JSON.stringify(doc.data,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
