"""Synthetic data only, for manual browser checks. Never uses private conversations."""
import base64
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
fixture=ROOT/'tests'/'fixture'
fixture.mkdir(exist_ok=True)
def node(id,role,content,parent,time,**kw):
    return {'id':id,'parent':parent,'message':{'id':id,'author':{'role':role},'content':content,'create_time':time,**kw}}
mapping={
 'q':node('q','user',{'content_type':'text','parts':['请计算 1 到 100 的和。']},None,1),
 'old':node('old','assistant',{'content_type':'text','parts':['旧分支回答：这里只应在切换分支后出现。']},'q',2),
 'code':node('code','assistant',{'content_type':'text','parts':['sum(range(1, 101))']},'q',3,recipient='python'),
 'tool':node('tool','tool',{'content_type':'execution_output','text':'5050'},'code',4),
 'recap':node('recap','assistant',{'content_type':'reasoning_recap','content':'这是一段很长的模拟摘要。'*15+'【摘要末尾：现在可以完整看到】'},'tool',5),
 'answer':node('answer','assistant',{'content_type':'multimodal_text','parts':['答案是 **5050**。\n\n```python\nprint(5050)\n```\n\n![外部图片](https://example.invalid/blocked.png)\n\n<img src="https://example.invalid/blocked-again.png" onerror="document.title=\'UNSAFE\'">\n\n<iframe src="https://example.invalid/"></iframe>',{'content_type':'image_asset_pointer','asset_pointer':'sediment://file_12345678'}]},'recap',6,
   metadata={'attachments':[{'id':'file_87654321','name':'说明.txt','mime_type':'text/plain'}]}),
}
c={'id':'synthetic','conversation_id':'synthetic','title':'修复版验收 · 分支、工具、摘要、附件与编辑','create_time':1,'update_time':6,'current_node':'answer','mapping':mapping,'unknown_big_number':900719925474099333}
(fixture/'conversations.json').write_text(json.dumps([c],ensure_ascii=False,indent=2),encoding='utf-8')
(fixture/'file_12345678.dat').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='))
(fixture/'file_87654321.dat').write_text('这是合成的附件下载测试。',encoding='utf-8')
(fixture/'conversation_asset_file_names.json').write_text(json.dumps({'file_12345678.dat':'预览.png','file_87654321.dat':'说明.txt'},ensure_ascii=False),encoding='utf-8')
(fixture/'chat.html').write_text('<html><script>var jsonData = '+json.dumps([c],ensure_ascii=True)+'; var assetsJson = {};</script><body>合成数据同步核验</body></html>',encoding='utf-8')
manifest={'export_files':[{'path':p.name,'size_bytes':p.stat().st_size} for p in fixture.iterdir() if p.name!='export_manifest.json']}
(fixture/'export_manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
spec=importlib.util.spec_from_file_location('builder',ROOT/'build_viewer.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
builder.build(fixture,ROOT/'tests'/'browser-check.html',force=True)
