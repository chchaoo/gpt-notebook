const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../viewer_core.js'),M=require('../viewer_markdown.js')(C,require('../marked.min.js')),{setup}=require('./dom_checks.cjs');
const cite='<Cite refs={["turn393305search2","turn393305search1"]}/>';
const link='<Link url="https://example.org/post?a=1&b=2" title="Windows Explorer solution"/>';
const choices='{@body const [choice,setChoice] = DL.useState("a") <box gap={3}><radio-group direction="col" value={choice} onChange={setChoice}><radio value="a">新增、删除或重命名</radio><radio value="b">文件大小和修改时间</radio><radio value="c">两种情况都有</radio></radio-group><row><button onClick={()=>GenUI.issueNewTurn(choice)}>确认情况</button></row></box>}';
test('export JSX citations and links display safely without exposing component source',()=>{
 const html=M.render('正文 '+cite+'\n\n'+link);assert.ok(html.includes('<sup>'));assert.ok(!html.includes('&lt;Cite'));assert.ok(html.includes('href="https://example.org/post?a=1&amp;b=2"'));assert.ok(html.includes('Windows Explorer solution'));
 const resolved=M.render(cite,{message:{metadata:{content_references:[{ref_id:'turn393305search2',url:'https://example.org/reference',title:'Source'}]}}});assert.ok(resolved.includes('href="https://example.org/reference"'));assert.ok(M.render(cite).includes('export-citation'));assert.equal(M.render(cite).includes('https://example.org/reference'),false);
});
test('exported GenUI questions become static choices, never executable code or send buttons',()=>{
 const html=M.render('先确认\n\n'+choices+'\n\n后续说明');for(const label of ['新增、删除或重命名','文件大小和修改时间','两种情况都有','后续说明'])assert.ok(html.includes(label));assert.ok(html.includes('<ul>'));for(const code of ['useState','issueNewTurn','<button','onClick','&lt;box'])assert.equal(html.includes(code),false);
});
test('code examples and unsupported components remain literal; malicious URLs stay inert',()=>{
 assert.ok(M.render('```jsx\n'+cite+'\n'+link+'\n```').includes('&lt;Cite'));assert.ok(M.render('`'+cite+'`').includes('&lt;Cite'));assert.ok(M.render('{@body arbitrary unknown code}').includes('arbitrary unknown code'));
 for(const url of ['javascript:alert(1)','file:///C:/private','data:text/html,bad'])assert.equal(M.render('<Link url="'+url+'" title="safe text"/>').includes('href='),false);assert.equal(M.render('<Cite refs={alert(1)}/>').includes('<sup>'),false);
});
test('rendering does not modify content or turn static choices into active controls',async()=>{
 const a=setup(),raw=JSON.stringify([{id:'markup',title:'样例',current_node:'a',mapping:{a:{parent:null,message:{author:{role:'assistant'},content:{content_type:'text',parts:[cite+'\n\n'+link+'\n\n'+choices]}}}}}]);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])}]);const body=a.document.querySelector('#msgs .msg-content');assert.ok(body.querySelector('a'));assert.equal(body.querySelectorAll('input,button,script').length,0);assert.ok(body.querySelector('.export-citation').title.includes('turn393305search2'));assert.equal(a.api.unsaved(),false);assert.equal(a.api.state.docs[0].text,raw);assert.equal(body.textContent.includes('useState'),false);
});
