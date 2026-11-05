const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../viewer_core.js'),M=require('../viewer_markdown.js')(C,require('../marked.min.js')),{setup}=require('./dom_checks.cjs');
const ref='turn393305search1',forms=[`<Cite ref="${ref}"/>`,`<Cite ref='${ref}' />`,`<Cite\n ref = {"${ref}"} />`];
test('single ref literal variants render inline or standalone with the screenshot citation preserved as a badge',()=>{
 for(const form of forms)for(const value of [form,'解决了问题。 '+form+' 后续文字']){const html=M.render(value);assert.ok(html.includes('<sup>'));assert.ok(html.includes(`title="${ref}"`));assert.equal(html.includes('&lt;Cite'),false);assert.equal(html.includes('href='),false)}
});
test('single references resolve only existing safe metadata, including grouped search sources',()=>{
 const message={metadata:{search_result_groups:[{entries:[{ref_id:ref,url:'https://example.org/source',title:'来源'}]}]}};assert.ok(M.render(forms[0],{message}).includes('href="https://example.org/source"'));message.metadata.search_result_groups[0].entries[0].url='javascript:alert(1)';assert.equal(M.render(forms[0],{message}).includes('href='),false);assert.ok(M.render(`<Cite refs={["${ref}","other"]}/>`).includes('[2]'));
});
test('single citation parsing never evaluates expressions or attributes, and code samples stay literal',()=>{
 for(const value of ['<Cite ref={alert(1)}/>','<Cite ref="x" onClick="alert(1)"/>','<Cite ref="x" ref="y"/>','<Cite ref=""/>','<Cite ref="x" refs={["y"]}/>'])assert.equal(M.render(value).includes('<sup>'),false);
 for(const value of ['`'+forms[0]+'`','```jsx\n'+forms[0]+'\n```'])assert.ok(M.render(value).includes('&lt;Cite'));
});
test('actual message rendering fixes the screenshot without changing stored content or creating edits',async()=>{
 const a=setup(),source=JSON.stringify([{id:'single-cite',title:'引用',current_node:'a',mapping:{a:{parent:null,message:{author:{role:'assistant'},content:{content_type:'text',parts:['通过禁用Windows的SMB目录缓存解决了问题。 '+forms[0]]}}}}}]);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([source])}]);const body=a.document.querySelector('.msg-content');assert.ok(body.querySelector('sup .export-citation'));assert.equal(body.textContent.includes('<Cite'),false);assert.equal(a.api.unsaved(),false);assert.equal(a.api.state.docs[0].text,source);
});
