const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./dom_checks.cjs');
async function open(question,answer='answer first\nanswer second'){
 const a=setup({editing:true}),record={id:'linebreaks',title:'合成换行测试',current_node:'a',mapping:{q:{parent:null,message:{author:{role:'user'},content:{content_type:'text',parts:[question]}}},a:{parent:'q',message:{author:{role:'assistant'},content:{content_type:'text',parts:[answer]}}}}};
 const raw=JSON.stringify([record]);await a.api.loadEntries([{path:'conversations.json',blob:new Blob([raw])}]);return {...a,raw};
}
test('user LF and CRLF single newlines display as breaks while original editing text and saved state stay intact',async()=>{
 for(const value of ['first\nsecond\n第三行','first\r\nsecond\r\n第三行']){
  const a=await open(value),body=a.document.querySelector('.msg.user .msg-content');assert.equal(body.querySelectorAll('br').length,2);
  assert.match(body.innerHTML,/first<br\s*\/?>(?:\n)?second<br\s*\/?>(?:\n)?第三行/);
  assert.equal(a.document.querySelector('.msg.assistant .msg-content').querySelectorAll('br').length,0);
  const r=a.api.state.records[0];assert.equal(r.raw.mapping.q.message.content.parts[0],value);assert.equal(r.doc.text,a.raw);assert.equal(a.api.unsaved(),false);
  a.api.editMessage(r,'q',r.raw.mapping.q.message);assert.equal(a.document.querySelector('#edit-fields textarea').value,value);assert.equal(a.api.unsaved(),false);
 }
});
test('user paragraphs, Markdown, code and untrusted HTML preserve their existing rendering rules',async()=>{
 const value='**first**\nsecond\n\nparagraph\n\n```text\ncode one\ncode two\n```\n\n<script>alert(1)</script>\ntail';
 const a=await open(value),body=a.document.querySelector('.msg.user .msg-content');assert.equal(body.querySelector('strong').textContent,'first');assert.ok(body.querySelectorAll('p').length>=3);assert.equal(body.querySelector('p').querySelectorAll('br').length,1);
  assert.equal(body.querySelector('pre code').textContent,'code one\ncode two\n');assert.equal(body.querySelector('pre').querySelectorAll('br').length,0);assert.equal(body.querySelector('script'),null);assert.ok(body.textContent.includes('<script>alert(1)</script>'));assert.equal(a.api.unsaved(),false);
});
test('print/PDF and edited preview use the same user linebreak behavior',async()=>{
 const a=await open('one\ntwo'),r=a.api.state.records[0];a.api.commit([{doc:r.doc,path:[0,'mapping','q','message','content','parts',0],value:'edited one\nedited two\nedited three'}]);
 assert.equal(a.document.querySelectorAll('.msg.user .msg-content br').length,2);assert.equal(a.api.unsaved(),true);a.ctx.print=()=>{};
 a.document.getElementById('quick-pdf').click();await a.api.startPrint();assert.equal(a.document.querySelectorAll('#print-document .msg.user .msg-content br').length,2);assert.equal(a.document.querySelectorAll('#print-document .msg.assistant .msg-content br').length,0);assert.equal(a.api.unsaved(),true);
});
