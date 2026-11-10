"""Build, test, and verify GPT Notebook from this repository alone."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys
sys.dont_write_bytecode = True
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'
PRODUCT = ROOT / 'gpt-notebook.html'
MANIFEST = ROOT / 'release-manifest.json'
ENV = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'}
EXCLUDED = {'.git', 'node_modules', '__pycache__', '.validation'}
TEMP_FILES = {'src/gpt-notebook.html', 'src/tests/browser-check.html'}

def run(args, cwd=ROOT):
    subprocess.run([str(x) for x in args], cwd=cwd, env=ENV, check=True)

def build():
    run([sys.executable, SRC/'build_viewer.py', '--blank', '--force', '-o', PRODUCT])

def test():
    run([sys.executable, ROOT/'tools/check_docs.py'])
    if not PRODUCT.is_file(): raise SystemExit('Run build first.')
    generated = SRC/'gpt-notebook.html'
    if generated.exists(): raise SystemExit('Temporary product already exists; inspect it before testing.')
    shutil.copy2(PRODUCT, generated)
    try:
        run([sys.executable, SRC/'tests/make_fixture.py'])
        run(['node', '--test', 'tests/*.test.cjs'], SRC)
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], SRC)
        run(['node', SRC/'tests/boot_generated.cjs', '--bundle'])
    finally:
        for p in (generated, SRC/'tests/browser-check.html'):
            if p.exists(): p.unlink()

def samples():
    run([sys.executable, ROOT/'tools/make_samples.py'])

def inventory():
    out = {}
    for parent, dirs, names in os.walk(ROOT, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not d.startswith('tmp'))
        for d in dirs:
            p = Path(parent)/d
            if p.is_symlink() or getattr(p, 'is_junction', lambda: False)(): raise ValueError('Linked directory: '+str(p.relative_to(ROOT)))
        for name in sorted(names):
            p = Path(parent)/name; rel = p.relative_to(ROOT).as_posix()
            if p == MANIFEST or rel in TEMP_FILES or p.suffix == '.pyc': continue
            if p.is_symlink(): raise ValueError('Linked file: '+rel)
            out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out

def freeze():
    files = inventory()
    MANIFEST.write_text(json.dumps({'product':'GPT Notebook', 'version':'1.1.2', 'sha256':files}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('Release manifest:', len(files), 'files')

def verify():
    expected = json.loads(MANIFEST.read_text(encoding='utf-8'))['sha256']; actual = inventory()
    errors = sorted(p for p in expected.keys() | actual.keys() if expected.get(p) != actual.get(p))
    print(json.dumps({'files':len(expected), 'errors':errors}, ensure_ascii=False, indent=2))
    if errors: raise SystemExit(1)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['build','test','freeze','verify','samples'])
    args=parser.parse_args(); globals()[args.action]()
if __name__ == '__main__': main()
