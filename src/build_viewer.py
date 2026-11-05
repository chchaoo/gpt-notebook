#!/usr/bin/env python3
"""Build a fully offline viewer; preserve raw JSON and embed actual attachment bytes.

Python 3.8+, standard library only. The same JavaScript data model is used by
folder loading and baked HTML; there is no second, divergent Python parser.
"""
import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
CONTROL_FILES = {'.viewer-backups/viewer-history.json', '.viewer-backups/viewer-settings.json', '.viewer-state/viewer-history.json', '.viewer-state/viewer-settings.json'}

CONVERSATIONS = re.compile(r'^conversations(?:-[^/]+)?\.json$', re.I)


def find_conversation_files(export_dir):
    root = Path(export_dir).resolve()
    return [p for p in sorted(root.rglob('*'))
            if p.is_file() and not p.is_symlink() and CONVERSATIONS.fullmatch(p.name)
            and root in p.resolve().parents
            and not any(part in ('.viewer-backups','.viewer-state','__MACOSX','.DS_Store') for part in p.relative_to(root).parts)]


def _load_template_and_marked(payload=None):
    substitutions = {
        'STYLE_CSS': 'viewer_styles.css', 'MARKED_JS': 'marked.min.js',
        'CORE_JS': 'viewer_core.js', 'APP_JS': 'viewer_app.js',
        'MARKDOWN_JS': 'viewer_markdown.js',
        'NAVIGATION_JS': 'viewer_navigation.js', 'TRANSFER_JS': 'viewer_transfer.js',
        'KATEX_JS': 'vendor/katex/dist/katex.min.js',
        'EDITOR_BUNDLE_JS':'vendor/toast-editor/toastui-editor.bundle.js',
        'EDITOR_LANGUAGE_JS':'vendor/toast-editor/dist/i18n/zh-cn.js','EDITOR_JS':'viewer_editor.js',
        'EXPORTS_JS':'viewer_exports.js',
        'JSZIP_JS':'vendor/jszip/jszip.min.js','STORAGE_JS':'viewer_storage.js',
        'RE2_JS':'vendor/re2js/build/index.umd.js','SEARCH_JS':'viewer_search.js',
        'I18N_JS':'viewer_i18n.js','PRINT_JS':'viewer_print.js',
        'PINYIN_JS':'vendor/pinyin-pro/dist/index.js','TITLE_INDEX_JS':'viewer_title_index.js',
        'OUTLINE_JS':'viewer_outline.js','HISTORY_JS':'viewer_history.js','JOURNAL_JS':'viewer_journal.js','JOURNAL_STORE_JS':'viewer_journal_store.js',
    }
    template = (SCRIPT_DIR / 'viewer_template.html').read_text(encoding='utf-8')
    values = {name: (SCRIPT_DIR / file).read_text(encoding='utf-8') for name, file in substitutions.items()}
    language_dir=SCRIPT_DIR/'vendor/toast-editor/dist/i18n'
    values['EDITOR_LANGUAGE_JS']='\n'.join(p.read_text(encoding='utf-8') for p in sorted(language_dir.glob('*.js')) if p.stem.lower()in ('zh-cn','zh-tw','ja-jp','ko-kr','fr-fr','de-de','es-es','pt-br','ru-ru','ar'))
    values['NOTEBOOK_LOGO'] = (SCRIPT_DIR / 'notebook-logo.svg').read_text(encoding='utf-8')
    katex_dir = SCRIPT_DIR / 'vendor' / 'katex' / 'dist'
    css = (katex_dir / 'katex.min.css').read_text(encoding='utf-8')
    def font_url(match):
        path = katex_dir / match.group(1).strip('"\'')
        mime = 'font/woff2' if path.suffix == '.woff2' else 'font/woff' if path.suffix == '.woff' else 'font/ttf'
        return 'url(data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode() + ')'
    values['STYLE_CSS'] += '\n' + re.sub(r'url\((fonts/[^)]+)\)', font_url, css)
    values['STYLE_CSS'] += '\n' + (SCRIPT_DIR/'vendor/toast-editor/dist/toastui-editor.css').read_text(encoding='utf-8')
    values['STYLE_CSS'] += '\n' + (SCRIPT_DIR/'vendor/toast-editor/dist/theme/toastui-editor-dark.css').read_text(encoding='utf-8')
    # Data cannot prematurely close its script element. Raw source text remains
    # a string inside this JSON envelope; decoding restores its original values.
    values['DATA'] = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    values['DATA'] = values['DATA'].replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    for name in ('MARKED_JS', 'CORE_JS', 'APP_JS', 'MARKDOWN_JS','NAVIGATION_JS','TRANSFER_JS','KATEX_JS','EDITOR_BUNDLE_JS','EDITOR_LANGUAGE_JS','EDITOR_JS','EXPORTS_JS','JSZIP_JS','STORAGE_JS','RE2_JS','SEARCH_JS','I18N_JS','PRINT_JS','PINYIN_JS','TITLE_INDEX_JS','OUTLINE_JS','HISTORY_JS','JOURNAL_JS','JOURNAL_STORE_JS'):
        if re.search(r'</script', values[name], re.I):
            raise ValueError('JavaScript source contains an unsafe closing script tag: ' + name)
    # Single pass: placeholders inside user messages must never be replaced.
    return re.sub(r'__([A-Z0-9_]+)__', lambda m: values.get(m.group(1),m.group(0)), template)


def _write(output_path, content, force=False):
    output = Path(output_path).resolve()
    if output.suffix.lower() != '.html':
        raise ValueError('输出文件必须使用 .html 扩展名')
    if output.exists() and not force:
        raise FileExistsError('输出已存在；请使用其他文件名，或用 --force 明确覆盖：' + str(output))
    if not output.parent.is_dir():
        raise ValueError('输出目录不存在：' + str(output.parent))
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='',
                                         dir=output.parent, suffix='.tmp', delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
        # Avoid replacing a file that appeared during a build unless authorized.
        if output.exists() and not force:
            raise FileExistsError('输出文件已出现，停止覆盖：' + str(output))
        os.replace(temp_path, output)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()
    return output


def build_blank(output_path, force=False):
    output = _write(output_path, _load_template_and_marked(), force)
    print('已生成空白查看器：{}（{:.1f} KB）'.format(output, output.stat().st_size / 1024), file=sys.stderr)


def build(export_dir, output_path, force=False):
    root, output = Path(export_dir).resolve(), Path(output_path).resolve()
    if not root.is_dir():
        raise ValueError('导出目录不存在：' + str(root))
    if output.name in ('chat.html', 'viewer_template.html'):
        raise ValueError('请使用新的输出文件名，不要覆盖导出的 chat.html 或源码模板')
    if not find_conversation_files(root):
        raise ValueError('目录中没有 conversations.json 或 conversations-*.json')
    sources, archive = [], []
    for item in sorted(root.rglob('*')):
        if not item.is_file() or item.is_symlink() or item.resolve() == output:
            continue
        if root not in item.resolve().parents:
            continue
        path = item.relative_to(root).as_posix()
        if (any(part in ('__MACOSX','.DS_Store') for part in item.relative_to(root).parts)
                or ('.viewer-backups' in item.relative_to(root).parts or '.viewer-state' in item.relative_to(root).parts) and path not in CONTROL_FILES and not re.fullmatch(r'\.viewer-backups/segments/[a-z0-9-]+\.json',path)):
            continue
        if CONVERSATIONS.fullmatch(item.name):
            # Preserve original line endings rather than Python newline conversion.
            text = item.read_bytes().decode('utf-8')
            value = json.loads(text.lstrip('\ufeff'))
            if not isinstance(value, list):
                raise ValueError('聊天 JSON 顶层不是数组：' + path)
            sources.append({'path': path, 'text': text})
        else:
            archive.append({'path': path, 'mime': mimetypes.guess_type(item.name)[0] or 'application/octet-stream',
                            'base64': base64.b64encode(item.read_bytes()).decode('ascii')})
    payload = {'version': 2, 'sources': sources, 'archive': archive}
    written = _write(output, _load_template_and_marked(payload), force)
    print('已生成自包含查看器：{}（{:.1f} MB）；{} 个聊天文件、{} 个其他文件，均已嵌入。'.format(
        written, written.stat().st_size / 1024 / 1024, len(sources), len(archive)), file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export_dir', nargs='?')
    parser.add_argument('-o', '--output')
    parser.add_argument('--blank', action='store_true')
    parser.add_argument('--force', action='store_true', help='允许覆盖指定的输出 HTML')
    args = parser.parse_args()
    try:
        if args.blank:
            build_blank(args.output or 'gpt-notebook.html', args.force)
        elif args.export_dir:
            build(args.export_dir, args.output or str(Path(args.export_dir) / 'viewer.html'), args.force)
        else:
            parser.error('请提供导出目录，或使用 --blank')
    except (OSError, ValueError) as error:
        parser.exit(1, '生成失败：' + str(error) + '\n')


if __name__ == '__main__':
    main()
