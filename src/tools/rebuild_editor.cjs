const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),shared=process.env.VIEWER_BUILD_DEPS||root,target=process.argv[2]?path.resolve(process.argv[2]):root;
const esbuild=require(path.join(shared,'node_modules/esbuild'));
const entry=path.join(shared,'node_modules/@toast-ui/editor/dist/esm/index.js');
const purify=path.join(shared,'node_modules/dompurify/dist/purify.es.mjs');
const output=path.join(target,'vendor/toast-editor/toastui-editor.bundle.js');
const original=fs.readFileSync(entry,'utf8'),declaration='var purify = createDOMPurify();';
if(original.split(declaration).length!==2)throw Error('Editor sanitizer integration point changed; review required');
const patched=path.join(target,'vendor/toast-editor/editor-modern-source.mjs');
fs.writeFileSync(patched,'import __ViewerDOMPurify from "dompurify";\n'+original.replace(declaration,'var purify = __ViewerDOMPurify;'));
const packageRoot=path.dirname(path.dirname(path.dirname(fs.realpathSync(entry))));
const result=esbuild.buildSync({stdin:{contents:'import Editor from '+JSON.stringify(patched)+';import purify from "dompurify";globalThis.toastui={Editor};globalThis.ViewerSanitizerVersion=purify.version;',resolveDir:shared},nodePaths:[shared+'/node_modules',shared+'/node_modules/.pnpm/node_modules',path.resolve(packageRoot,'../..')],alias:{dompurify:purify},bundle:true,platform:'browser',target:'es2020',outfile:output,minify:true,legalComments:'eof',metafile:true});
const packages=new Map(),licenses=path.join(target,'vendor/toast-editor/licenses');fs.mkdirSync(licenses,{recursive:true});
for(const input of Object.keys(result.metafile.inputs)){
 if(input==='<stdin>')continue;
 let dir=path.dirname(fs.realpathSync(path.resolve(input)));
 while(dir!==path.dirname(dir)&&!fs.existsSync(path.join(dir,'package.json')))dir=path.dirname(dir);
 if(!fs.existsSync(path.join(dir,'package.json')))continue;
 const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));if(['gpt-notebook-source','gpt-notebook'].includes(pkg.name)||packages.has(pkg.name))continue;
 const retained=[];
 for(const file of fs.readdirSync(dir).filter(n=>/^(LICENSE|COPYING)/i.test(n))){const name=pkg.name.replace(/[@/]/g,'_')+'-'+file;fs.copyFileSync(path.join(dir,file),path.join(licenses,name));retained.push('licenses/'+name)}
 packages.set(pkg.name,{name:pkg.name,version:pkg.version,license:pkg.license||null,licenseFiles:retained});
}
packages.set('@toast-ui/editor',{name:'@toast-ui/editor',version:'3.2.2',license:'MIT',licenseFiles:['LICENSE'],note:'The inlined old sanitizer instance is replaced with the explicit DOMPurify import before bundling.'});
fs.writeFileSync(path.join(target,'vendor/toast-editor/构建依赖.json'),JSON.stringify({builder:'esbuild '+esbuild.version,entry:'@toast-ui/editor/dist/esm/index.js',override:'DOMPurify 3.4.17',packages:[...packages.values()]},null,2));
fs.unlinkSync(patched); // Remove the intermediate only after inspecting the build inputs.
console.log('Bundled editor from ESM with updated sanitizer; packages:',packages.size,'bytes:',fs.statSync(output).size);
