"""Check authored local documentation links and anchors."""
from pathlib import Path
import re, unicodedata

ROOT=Path(__file__).resolve().parents[1]

def anchors(path):
    values=set(); seen={}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',path.read_text(encoding='utf-8'),re.M):
        text=re.sub(r'[`*_]','',heading).lower()
        text=''.join(c for c in text if c in ' -_' or unicodedata.category(c)[0] in 'LN')
        slug=text.replace(' ','-');n=seen.get(slug,0);seen[slug]=n+1
        values.add(slug+('-'+str(n) if n else ''))
    return values

def main():
    files=list(ROOT.glob('*.md'))+list((ROOT/'docs').rglob('*.md'))+list((ROOT/'examples').rglob('*.md'))
    errors=[];count=0
    for source in files:
        for target in re.findall(r'\]\(([^)]+)\)',source.read_text(encoding='utf-8')):
            if re.match(r'^[a-z]+:',target):continue
            name,sep,anchor=target.partition('#');dest=(source.parent/name).resolve() if name else source
            count+=1
            if not dest.is_relative_to(ROOT) or not dest.exists():errors.append(f'{source.relative_to(ROOT)}: missing {target}')
            elif sep and dest.suffix=='.md' and anchor not in anchors(dest):errors.append(f'{source.relative_to(ROOT)}: missing anchor {target}')
    print(f'Documentation: {len(files)} files, {count} local links; {len(errors)} errors')
    for error in errors:print(error)
    if errors:raise SystemExit(1)

if __name__=='__main__':main()
