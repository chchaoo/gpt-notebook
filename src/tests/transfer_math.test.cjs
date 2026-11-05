const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../viewer_transfer.js'),C=require('../viewer_core.js'),M=require('../viewer_markdown.js')(C,require('../marked.min.js')),K=require('../vendor/katex/dist/katex.min.js');
test('drag handles are captured before DataTransfer protection resumes',async()=>{
 let calls=0;const handles=[{kind:'file',name:'a.json',getFile:async()=>new Blob(['a'])},{kind:'file',name:'b.json',getFile:async()=>new Blob(['b'])}];
 const captured=T.capture({items:handles.map(h=>({kind:'file',getAsFileSystemHandle(){calls++;return Promise.resolve(h)}})),files:[]});assert.equal(calls,2);assert.equal((await T.read(captured)).length,2);
});
test('URI failure in modern API falls back to complete legacy enumeration',async()=>{
 const file={isFile:true,name:'conversations.json',file:resolve=>resolve(new Blob(['[]']))};let batches=0;
 const legacy={isDirectory:true,name:'folder',createReader:()=>({readEntries:resolve=>resolve(batches++?[ ]:[file])})};
 const cap={handles:[Promise.resolve({kind:'file',name:'x',getFile:async()=>{throw new Error('A URI supplied to the API was malformed')}})],legacy:[legacy],files:[]};
 const entries=await T.read(cap);assert.equal(entries[0].path,'conversations.json');assert.equal(await entries[0].blob.text(),'[]');
});
test('legacy reader drains all batches and unsupported drops give an actionable error',async()=>{
 let n=0;const file=name=>({isFile:true,name,file:resolve=>resolve(new Blob(['x']))});
 const entry={isDirectory:true,createReader:()=>({readEntries:resolve=>resolve(n++===0?[file('a')]:n===2?[file('b')]:[])})};
 assert.equal((await T.read({handles:[],legacy:[entry],files:[]})).length,2);
 await assert.rejects(T.read({handles:[],legacy:[],files:[]}),/选择导出目录/);
});
test('LaTeX delimiters survive Markdown and render integral / aligned / boxed formulas',()=>{
 for(const source of ['\\[ I=\\int_0^{3+i}z^2\\,dz \\]','$$F(z)=\\frac{z^3}{3}$$','text \\( z^2 \\) and $x^2$'])assert.ok(M.render(source).includes('math-slot'));
 for(const tex of ['I=\\int_0^{3+i}z^2\\,dz','\\begin{aligned}I&=\\frac{18+26i}{3}\\\\&=6+\\frac{26}{3}i\\end{aligned}','\\boxed{I=6+\\frac{26}{3}i}']){
  const result=K.renderToString(tex,{throwOnError:false,trust:false});assert.ok(result.includes('katex'));assert.ok(!result.includes('katex-error'));
 }
});
test('code examples and ordinary prices are not converted to math',()=>{
 assert.ok(!M.render('```tex\n\\[x\\]\n```').includes('math-slot'));
 assert.ok(!M.render('`$x$`').includes('math-slot'));
 assert.ok(!M.render('price $20 then $30').includes('math-slot'));
});
test('untrusted formula URLs do not produce active javascript links',()=>{
 const output=K.renderToString('\\href{javascript:alert(1)}{x}',{trust:false,throwOnError:false});assert.ok(!output.includes('href="javascript:'));
});
