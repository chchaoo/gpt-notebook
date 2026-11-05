const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../viewer_core.js'),M=require('../viewer_markdown.js')(C,require('../marked.min.js')),{setup}=require('./dom_checks.cjs');
const ids=['turn782516search2','turn782516search3'],label='〔引用：'+ids.join('、')+'〕',native='cite'+ids.join('')+'';
test('native and readable citation markers render as safe source badges with identical output',()=>{
 const message={metadata:{content_references:[{ref_id:ids[0],url:'https://example.org/one?a=1&b=2',title:'First "source"'}],search_result_groups:[{entries:[{ref_ids:[ids[1]],url:'https://example.org/two',title:'Second'}]}]}};
 const expected=M.render('正文 '+label+' 后续',{message});assert.equal(M.render('正文 '+native+' 后续',{message}),expected);assert.ok(expected.includes('<sup>'));assert.ok(expected.includes('href="https://example.org/one?a=1&amp;b=2"'));assert.ok(expected.includes('href="https://example.org/two"'));assert.equal(expected.includes('〔引用：'),false);assert.ok(expected.includes('[1]'));assert.ok(expected.includes('[2]'));assert.ok(expected.includes('First &quot;source&quot;'));
});
test('missing, unsafe or other-message sources never become invented links and render context does not leak',()=>{
 const message={metadata:{content_references:[{reference_id:ids[0],url:'https://example.org/allowed'},{source_ref_id:ids[1],url:'javascript:alert(1)'}]}};
 const found=M.render(label,{message});assert.ok(found.includes('href="https://example.org/allowed"'));assert.ok(found.includes('class="export-citation" title="'+ids[1]+'"'));assert.equal(found.includes('javascript:'),false);
 const missing=M.render(label);assert.equal(missing.includes('href='),false);for(const id of ids)assert.ok(missing.includes('title="'+id+'"'));assert.ok(M.render('〔引用：turn0file0〕').includes('<sup>'));
});
test('citation examples in code and invalid markers stay literal; link labels do not create nested links',()=>{
 for(const text of ['`'+label+'`','```text\n'+label+'\n```']){const html=M.render(text);assert.equal(html.includes('<sup>'),false);assert.ok(html.includes(label))}
 for(const text of ['〔引用：普通文字〕','〔引用：turn1search0、〕','〔引用：turn1search0" onclick="bad〕','〔引用：turn1search0\n、turn2search0〕'])assert.equal(M.render(text).includes('<sup>'),false);
 const html=M.render('['+label+'](https://example.org/outer)',{message:{metadata:{content_references:[{ref_id:ids[0],url:'https://example.org/inner'}]}}});assert.equal((html.match(/<a /g)||[]).length,1);
});
test('actual preview and print resolve citation badges without editing source or dirtying the workspace',async()=>{
 const a=setup(),message={author:{role:'assistant'},content:{content_type:'text',parts:['结论 '+native]},metadata:{content_references:[{ref_id:ids[0],url:'https://example.org/source',title:'Synthetic source'}]}};
 const source=JSON.stringify([{id:'native-cite',title:'引用合成样例',current_node:'a',mapping:{a:{parent:null,message}}}]);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([source])}]);
 const body=a.document.querySelector('#msgs .msg-content');assert.ok(body.querySelector('sup a[href="https://example.org/source"]'));assert.equal(body.querySelector('.export-citation').title,ids[1]);assert.equal(body.textContent.includes('〔引用：'),false);assert.equal(a.api.unsaved(),false);assert.equal(a.api.state.docs[0].text,source);
 a.ctx.print=()=>{};a.document.getElementById('quick-pdf').click();await a.api.startPrint();assert.ok(a.document.querySelector('#print-document sup a[href="https://example.org/source"]'));assert.equal(a.document.querySelector('#print-document .export-citation').title,ids[1]);assert.equal(a.api.unsaved(),false);
 const r=a.api.state.records[0];a.api.editMessage(r,'a',r.raw.mapping.a.message);assert.equal(a.document.querySelector('#edit-fields textarea').value,'结论 '+native);assert.equal(a.api.unsaved(),false);
});
