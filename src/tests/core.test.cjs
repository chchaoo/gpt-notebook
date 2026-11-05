const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../viewer_core.js');
const msg = (text,time=1,extra={}) => ({author:{role:'assistant'},content:{content_type:'text',parts:[text]},create_time:time,...extra});

test('edits preserve untouched JSON tokens, large integers, CRLF and metadata', () => {
  const raw = '[\r\n {"title":"old", "mapping":{"n":{"message":{"content":{"parts":["a","b"]}}}},"huge":90071992547409931234567,"float":1.2300e+99,"unknown":{"__DATA__":"\\u4e2d"}}\r\n]';
  const doc=C.document(raw);
  C.change(doc,[0,'title'],'新标题😀'); C.change(doc,[0,'mapping','n','message','content','parts',1],'line\n"b"');
  const output=C.serialize(doc);
  assert.equal(output,raw.replace('"old"',JSON.stringify('新标题😀')).replace('"b"',JSON.stringify('line\n"b"')));
  C.change(doc,[0,'title'],'old'); C.change(doc,[0,'mapping','n','message','content','parts',1],'b');
  assert.equal(C.serialize(doc),raw); assert.equal(doc.changes.size,0);
});
test('patch scanner understands escaped object keys, nested arrays and BOM',()=>{
  const raw='\uFEFF{ "a\\\"b": [null, {"c":"😀"}], "n":-2.3e-25 }';
  const output=C.patch(raw,[{path:['a"b',1,'c'],value:'x'},{path:['n'],value:42}]);
  assert.equal(output,'\uFEFF{ "a\\\"b": [null, {"c":"x"}], "n":42 }');
  assert.throws(()=>C.patch(raw,[{path:['missing'],value:'x'}]));
});
test('unmodified extremely long numbers are not serialized or truncated',()=>{
  const raw='[{"title":"a","number":'+ '1'.repeat(700)+'}]';
  const doc=C.document(raw);C.change(doc,[0,'title'],'b');
  assert.equal(C.serialize(doc),raw.replace('"a"','"b"'));
});
test('only existing string fields are editable',()=>{
  const doc=C.document('[{"n":12}]');assert.throws(()=>C.change(doc,[0,'n'],'12'));
  assert.throws(()=>C.change(doc,[0,'missing'],'x'));assert.throws(()=>C.change(doc,[0,'n'],13));
});
test('current branch follows parents and excludes regenerated answer',()=>{
  const c={current_node:'new',mapping:{root:{message:null,parent:null},q:{message:msg('q'),parent:'root'},old:{message:msg('old',2),parent:'q'},new:{message:msg('new',3),parent:'q'}}};
  assert.deepEqual(C.branch(c).ids,['root','q','new']); assert.deepEqual(C.branch(c,'old').ids,['root','q','old']);
  assert.equal(C.branch(c,'__all__').ids.length,4);assert.deepEqual(C.branch(c).leaves,['new','old']);
});
test('broken branch references and cycles produce warnings without looping',()=>{
  assert.equal(C.branch({current_node:'a',mapping:{a:{parent:'a',message:msg('a')}}}).warnings.length,1);
  assert.equal(C.branch({current_node:'a',mapping:{a:{parent:'missing',message:msg('a')}}}).warnings.length,1);
  assert.doesNotThrow(()=>C.branch({mapping:{bad:null,other:2}}));
});
test('missing current_node chooses most recent leaf',()=>{
  assert.equal(C.branch({mapping:{a:{message:msg('a',1)},b:{message:msg('b',8)}}}).leaf,'b');
});
test('tool recipient, tool calls and legacy roles are recognized',()=>{
  assert.equal(C.classification(msg('request',1,{recipient:'python'})).tool,true);
  assert.equal(C.classification(msg('normal',1,{recipient:'all'})).tool,false);
  assert.equal(C.classification(msg('x',1,{author:{role:'function'}})).tool,true);
  assert.equal(C.classification(msg('x',1,{tool_calls:[{id:'x'}]})).tool,true);
  assert.equal(C.classification({content:{content_type:'reasoning_recap'}}).thought,true);
});
test('recap full text, PDF metadata and unknown message fields remain accessible',()=>{
  const long='x'.repeat(200)+'end';assert.equal(C.blocks({content:{content_type:'reasoning_recap',content:long}})[0].text,long);
  const pdf=C.blocks(msg('read',1,{metadata:{attachments:[{id:'file_12345678',name:'paper.pdf',mime_type:'application/pdf'}]}}));
  assert.equal(pdf[1].name,'paper.pdf');assert.equal(pdf[1].id,'file_12345678');
  assert.ok(C.blocks({content:{content_type:'future',surprise:123}})[0].text.includes('surprise'));
});
test('multimodal parts keep sequence and avoid duplicate attachment links',()=>{
  const blocks=C.blocks({content:{content_type:'multimodal_text',parts:['before',{content_type:'image_asset_pointer',asset_pointer:'sediment://file_12345678'},'after']},metadata:{attachments:[{id:'file_12345678'}]}});
  assert.deepEqual(blocks.map(b=>b.type),['markdown','asset','markdown']);
});
test('raw code containing triple backticks gets an intact code fence',()=>{
  assert.ok(C.blocks({content:{content_type:'code',text:'print("```")',language:'python'}})[0].text.startsWith('````python'));
});
test('unsafe URL schemes and remote automatic resources are rejected',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https:\n//x','//example.com'])assert.equal(C.safeURL(value),null);
  assert.equal(C.safeURL('https://example.com/image.png','resource'),null);
  assert.ok(C.safeURL('data:image/png;base64,AAAA','resource'));
  assert.equal(C.safeURL('data:image/svg+xml;base64,AAAA','resource'),null);
  assert.equal(C.safeURL('https://example.com'),'https://example.com');
});
test('citation identifiers remain visible',()=>{
  assert.equal(C.displayText('来源citeturn1search0'),'来源〔引用：turn1search0〕');
});
test('all shard names follow the same rule and do not match lookalikes',()=>{
  for(const file of ['conversations.json','conversations-001.json','conversations-extra.json'])assert.ok(C.conversationFile(file));
  for(const file of ['my-conversations.json','conversations.json.exe'])assert.ok(!C.conversationFile(file));
});
test('chat.html synchronization preserves raw numbers and escapes script terminators',()=>{
  const html='<script>var jsonData = [{"old":[1,2]}]; var assetsJson = {};</script>';
  const data='[{"huge":900719925474099333,"text":"</script>"}]';
  const output=C.syncChatHTML(html,data);
  assert.ok(output.includes('900719925474099333'));assert.ok(output.includes('\\u003c/script>'));assert.ok(output.endsWith('var assetsJson = {};</script>'));
  assert.throws(()=>C.syncChatHTML('<html></html>',data));
});
test('shard combining retains source number literals',()=>{
  assert.equal(C.combineSources([' [ {"n":900719925474099333} ] ','[]','[{"b":2}]']),'[{"n":900719925474099333},\n{"b":2}]');
});
test('archive paths reject traversal, duplicates and absolute paths',async()=>{
  for(const p of ['../a','/a','C:/x','a/../b','a\\b','a//b'])assert.equal(C.validPath(p),false);
  assert.equal(C.validPath('目录/附件.txt'),true);
  await assert.rejects(C.zip([{path:'a',blob:new Blob(['a'])},{path:'a',blob:new Blob(['b'])}]));
});
test('ZIP stores correct CRC and UTF-8 file names',async()=>{
  assert.equal(C.crc32(new TextEncoder().encode('123456789')),0xCBF43926);
  const zip=await C.zip([{path:'测试.txt',blob:new Blob(['hello😀'])}]);
  const bytes=new Uint8Array(await zip.arrayBuffer()), view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034B50);assert.equal(view.getUint16(6,true),0x800);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054B50);
});
