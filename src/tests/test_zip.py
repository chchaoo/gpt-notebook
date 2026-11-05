import io
from pathlib import Path
import subprocess
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]


class ZipTests(unittest.TestCase):
    def test_browser_zip_is_readable_with_python_crc_validation(self):
        script="""const C=require('./viewer_core.js');
(async()=>{const zip=await C.zip([{path:'目录/文本.txt',blob:new Blob(['hello😀'])},{path:'bytes.dat',blob:new Blob([Uint8Array.from([0,255,1,128])])}]);process.stdout.write(Buffer.from(await zip.arrayBuffer()))})().catch(e=>{console.error(e);process.exitCode=1});"""
        result=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,check=True)
        with zipfile.ZipFile(io.BytesIO(result.stdout)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read('目录/文本.txt').decode(),'hello😀')
            self.assertEqual(archive.read('bytes.dat'),bytes([0,255,1,128]))


if __name__=='__main__':unittest.main()
