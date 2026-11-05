"""Generate public, fictional archives and temporary screenshot pages. Reads no user exports."""
from pathlib import Path
import importlib.util, json, subprocess, zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    spec = importlib.util.spec_from_file_location('builder', ROOT/'src/build_viewer.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    for locale in ('en', 'zh-CN'):
        folder = ROOT/'.validation'/locale/'sample-archive'
        folder.mkdir(parents=True, exist_ok=True)
        zh = locale == 'zh-CN'
        text = (lambda en, cn: cn if zh else en)
        prompts = [
            ('A weekend reading plan', '周末阅读计划', 'Plan a quiet weekend with time for reading.\nInclude a short walk and a few notes.', '安排一个适合阅读的安静周末。\n留出散步和整理笔记的时间。',
             '# A little space to read\n\nKeep the plan light: one book, a notebook, and time away from the screen.\n\n| When | Plan |\n| --- | --- |\n| Saturday morning | Read two chapters |\n| Saturday afternoon | Walk in the park |\n| Sunday morning | Write a short reflection |\n\n## Three questions for your notes\n\n- What surprised you?\n- Which idea would you try?\n- What would you like to read next?\n\n> Leave a little unscheduled time.',
             '# 留一点时间，慢慢读\n\n一本书、一本笔记，再留一点远离屏幕的时间。计划不用排满。\n\n| 时间 | 安排 |\n| --- | --- |\n| 周六上午 | 阅读两个章节 |\n| 周六下午 | 去公园散步 |\n| 周日上午 | 写一段阅读感想 |\n\n## 记笔记时，可以想想\n\n- 哪个观点让你意外？\n- 哪个方法值得试一次？\n- 下一本想读什么？\n\n> 留白也是计划的一部分。'),
            ('Python: a small reading log', 'Python：一个简单的阅读记录', 'Show a small Python example that totals reading minutes.', '用一个简单的 Python 示例，统计一周的阅读时间。',
             '## A seven-day reading log\n\n```python\nminutes = [20, 35, 0, 25, 30, 45, 40]\ntotal = sum(minutes)\nprint(f"This week: {total} minutes")\n```\n\nThe total is **195 minutes**. Start small and keep the record useful.',
             '## 记录七天的阅读时间\n\n```python\nminutes = [20, 35, 0, 25, 30, 45, 40]\ntotal = sum(minutes)\nprint(f"本周阅读：{total} 分钟")\n```\n\n合计 **195 分钟**。记录简单一些，才容易坚持。'),
            ('Math: the sum of a sequence', '数学：等差数列求和', 'How do I add the numbers from 1 to 100?', '如何计算从 1 加到 100 的和？',
             '## Pair the first and last numbers\n\nEach pair adds up to 101. There are 50 pairs.\n\n$$S=\\frac{n(n+1)}{2}=\\frac{100\\times101}{2}=5050$$\n\nSo the answer is **5050**.',
             '## 把首尾两个数配成一组\n\n每组的和为 101，一共 50 组。\n\n$$S=\\frac{n(n+1)}{2}=\\frac{100\\times101}{2}=5050$$\n\n因此答案是 **5050**。'),
        ]
        rows = []
        for i, (te, tc, qe, qc, ae, ac) in enumerate(prompts):
            stamp = 1780272000+i*86400
            mapping = {}
            for ident, role, body, parent in [('q', 'user', text(qe,qc), None), ('a', 'assistant', text(ae,ac), 'q')]:
                mapping[ident] = {'id':ident, 'parent':parent, 'message':{'id':ident,'author':{'role':role},'create_time':stamp+(role=='assistant'),'content':{'content_type':'text','parts':[body]}}}
            rows.append({'id':f'sample-{i}', 'conversation_id':f'sample-{i}', 'title':text(te,tc), 'create_time':stamp, 'update_time':stamp+1, 'current_node':'a', 'mapping':mapping})
        (folder/'conversations.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
        subprocess.run(['node',str(ROOT/'tools/seed_sample_history.cjs'),str(folder),locale],check=True)
        output = ROOT/'examples'/locale/'sample-archive.zip'
        output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(folder.rglob('*')):
                if p.is_file():
                    info=zipfile.ZipInfo(p.relative_to(folder).as_posix(),(2026,6,1,0,0,0))
                    info.compress_type=zipfile.ZIP_DEFLATED
                    archive.writestr(info,p.read_bytes())
        builder.build(folder,folder.parent/'preview.html',force=True)
    print('Generated fictional English and Chinese samples. Preview HTML stays in .validation/.')

if __name__ == '__main__': main()
