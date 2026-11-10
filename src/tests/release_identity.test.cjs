const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{setup}=require('./dom_checks.cjs');
test('public v1.1 identity is GPT Notebook in the template and bundled blank distribution',()=>{
 const a=setup();assert.equal(a.document.title,'GPT Notebook · v1.1');assert.equal(a.document.querySelector('#loader h1').textContent,'GPT Notebook');assert.equal(a.document.querySelector('.sb-logo-text').textContent,'GPT Notebook · v1.1');
 const html=fs.readFileSync(path.join(__dirname,'../gpt-notebook.html'),'utf8');assert.ok(html.includes('<title>GPT Notebook · v1.1</title>'));assert.match(html,/<script id="data" type="application\/json">null<\/script>/);assert.ok(html.includes("connect-src 'none'"));
});
test('independent notebook icon and public package version keep existing archive protocol compatibility',()=>{
 const src=path.join(__dirname,'..'),repo=path.join(src,'..');assert.equal(fs.existsSync(path.join(src,'chatgpt-logo.svg')),false);assert.match(fs.readFileSync(path.join(src,'notebook-logo.svg'),'utf8'),/<rect/);assert.equal(require('../package.json').version,'1.1.0');assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).name,'gpt-notebook');
 const source=JSON.parse(fs.readFileSync(path.join(repo,'SOURCE.json'),'utf8'));assert.deepEqual(source.storageProtocols,[141,143]);assert.equal(source.product,'GPT Notebook');assert.equal(source.version,'1.1.0');assert.deepEqual(Object.keys(source).sort(),['license','product','repository','storageProtocols','upstream','version']);
});
