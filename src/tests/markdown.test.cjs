const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../viewer_core.js');
const M=require('../viewer_markdown.js')(C,require('../marked.min.js'));
test('raw HTML is displayed as text without active tags or event handlers',()=>{
  const out=M.render('<img src="x" onerror="alert(1)"><iframe src="x"></iframe><script>alert(1)</script>');
  assert.ok(!/<(?:img|iframe|script)\b/.test(out));assert.ok(out.includes('&lt;img'));
});
test('remote Markdown images become click-only links',()=>{
  const out=M.render('![photo](https://example.invalid/pixel.png)');
  assert.ok(!out.includes('<img'));assert.ok(out.includes('href="https://example.invalid/pixel.png"'));
});
test('dangerous schemes do not enter href or src attributes',()=>{
  for(const source of ['[x](javascript:alert%281%29)','![x](data:text/html,hi)','[x](file:///C:/secret)','[x](vbscript:msgbox)']){
    assert.ok(!/\b(?:href|src)=/.test(M.render(source)));
  }
});
test('attribute injection is escaped in both image and link output',()=>{
  const output=M.render('[x](https://example.com "onmouseover=bad") ![x](data:image/png;base64,AAAA "bad")');
  assert.ok(!/\s(?:onclick|onmouseover|onerror)=/.test(output));
});
test('GFM tables, checked tasks and nested formatting survive',()=>{
  const out=M.render('| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] pending\n\n**strong**');
  assert.ok(out.includes('<table>'));assert.ok(out.includes('☑'));assert.ok(out.includes('☐'));assert.ok(out.includes('<strong>strong</strong>'));
});
test('code HTML stays inert and citation labels remain available',()=>{
  const out=M.render('```html\n<script>test</script>\n```\n\nciteturn1search0');
  assert.ok(out.includes('&lt;script&gt;'));assert.ok(out.includes('turn1search0'));
});
