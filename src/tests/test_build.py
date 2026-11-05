import base64
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('builder',ROOT/'build_viewer.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'tests')
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to((ROOT/'tests').resolve()))
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.source=self.root/'export'
        self.source.mkdir()
        self.raw='[\r\n {"title":"</script>__APP_JS__","mapping":{},"huge":900719925474099333}\r\n]'
        (self.source/'conversations.json').write_bytes(self.raw.encode())
        (self.source/'file_12345678.dat').write_bytes(b'attachment\x00bytes')

    def payload(self,html):
        return json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>',html,re.S).group(1))

    def test_blank(self):
        out=self.root/'blank.html';builder.build_blank(out)
        html=out.read_text(encoding='utf-8')
        self.assertIsNone(self.payload(html))
        self.assertIn('connect-src \'none\'',html)
        for name in ['__CORE_JS__','__APP_JS__','__MARKDOWN_JS__','__MARKED_JS__','__DATA__','__STYLE_CSS__','__RE2_JS__','__PINYIN_JS__','__PRINT_JS__','__OUTLINE_JS__','__HISTORY_JS__','__JOURNAL_JS__','__JOURNAL_STORE_JS__']:
            self.assertNotIn(name,html)

    def test_backup_files_never_become_imported_chats(self):
        backup=self.source/'.viewer-backups'/'old';backup.mkdir(parents=True)
        (backup/'conversations.json').write_text('[{"title":"PRIVATE BACKUP","mapping":{}}]',encoding='utf-8')
        out=self.root/'without-backup.html';builder.build(self.source,out)
        data=self.payload(out.read_text(encoding='utf-8'))
        self.assertEqual(len(data['sources']),1)
        self.assertFalse(any('.viewer-backups' in item['path'] for item in data['archive']))

    def test_private_history_and_settings_survive_baked_build(self):
        folder=self.source/'.viewer-backups'
        folder.mkdir()
        for name in ('viewer-history.json','viewer-settings.json'):
            (folder/name).write_text('{"version":141}',encoding='utf-8')
        segment=folder/'segments';segment.mkdir()
        (segment/'20261030t000000000z-demo.json').write_text('{}',encoding='utf-8')
        out=self.root/'with-history.html'
        builder.build(self.source,out)
        data=self.payload(out.read_text(encoding='utf-8'))
        self.assertEqual(len(data['sources']),1)
        paths={item['path'] for item in data['archive']}
        self.assertTrue({'.viewer-backups/viewer-history.json','.viewer-backups/viewer-settings.json','.viewer-backups/segments/20261030t000000000z-demo.json'} <= paths)

    def test_separate_state_controls_survive_without_importing_unknown_private_files(self):
        state=self.source/'.viewer-state';state.mkdir()
        for name in ('viewer-history.json','viewer-settings.json'):
            (state/name).write_text('{"version":143}',encoding='utf-8')
        (state/'unrelated.json').write_text('[]',encoding='utf-8')
        folder=self.source/'.viewer-backups'/'segments';folder.mkdir(parents=True)
        (folder/'20261030t000000000z-demo.json').write_text('{}',encoding='utf-8')
        out=self.root/'with-state.html';builder.build(self.source,out)
        data=self.payload(out.read_text(encoding='utf-8'))
        self.assertEqual(len(data['sources']),1)
        paths={item['path'] for item in data['archive']}
        self.assertTrue({'.viewer-state/viewer-history.json','.viewer-state/viewer-settings.json','.viewer-backups/segments/20261030t000000000z-demo.json'} <= paths)
        self.assertNotIn('.viewer-state/unrelated.json',paths)

    def test_baked_contains_raw_sources_and_actual_bytes(self):
        out=self.root/'elsewhere.html';builder.build(self.source,out)
        html=out.read_text(encoding='utf-8');data=self.payload(html)
        self.assertEqual(data['sources'][0]['text'],self.raw)
        self.assertEqual(base64.b64decode(data['archive'][0]['base64']),b'attachment\x00bytes')
        self.assertIn('900719925474099333',data['sources'][0]['text'])
        self.assertNotIn('</script>__APP_JS__',html)
        self.assertEqual((self.source/'conversations.json').read_bytes(),self.raw.encode())

    def test_overwrite_requires_force(self):
        out=self.root/'a.html';out.write_text('original')
        with self.assertRaises(FileExistsError):builder.build_blank(out)
        self.assertEqual(out.read_text(),'original')
        builder.build_blank(out,force=True)

    def test_not_overwrite_original_chat(self):
        with self.assertRaises(ValueError):builder.build(self.source,self.source/'chat.html',force=True)

    def test_nonarray_and_malformed_json_fail_without_output(self):
        out=self.root/'a.html'
        for value in ['{}','not json']:
            (self.source/'conversations.json').write_text(value)
            with self.assertRaises(ValueError):builder.build(self.source,out)
            self.assertFalse(out.exists())

    def test_shards_and_nested_paths_match_browser_rule(self):
        (self.source/'conversations-extra.json').write_text('[]')
        sub=self.source/'子目录';sub.mkdir();(sub/'conversations-001.json').write_text('[]')
        out=self.root/'a.html';builder.build(self.source,out)
        self.assertEqual(len(self.payload(out.read_text(encoding='utf-8'))['sources']),3)

    def test_output_is_not_recursively_embedded(self):
        out=self.source/'viewer.html';builder.build(self.source,out)
        builder.build(self.source,out,force=True)
        self.assertEqual(len(self.payload(out.read_text(encoding='utf-8'))['archive']),1)

    def test_utf8_bom_is_preserved_in_source_text(self):
        raw='\ufeff'+self.raw
        (self.source/'conversations.json').write_bytes(raw.encode())
        out=self.root/'a.html';builder.build(self.source,out)
        self.assertEqual(self.payload(out.read_text(encoding='utf-8'))['sources'][0]['text'],raw)


if __name__=='__main__':unittest.main()
