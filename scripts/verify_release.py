"""Verify the exact public release assets before publication."""
from pathlib import Path
import argparse,hashlib,json,re,zipfile,os,runpy
from packaging.version import Version
VERSION=runpy.run_path(str(Path(__file__).resolve().parents[1]/'src/computer_bridge/__init__.py'))['__version__']
EXPECTED={
 f'computer-bridge-{VERSION}-install.zip',
 f'computer-bridge-client-{VERSION}.zip',
 f'computer-bridge-server-node-{VERSION}.zip',
 f'computer-bridge-updater-{VERSION}.zip',
 f'computer-bridge-cloudflare-base-{VERSION}.mjs',
 f'computer-bridge-cloudflare-work-tree-{VERSION}.mjs',
 f'computer-bridge-work-tree-server-{VERSION}.mjs',
 f'computer_bridge_work_tree-{Version(VERSION)}-py3-none-any.whl',
 'release-manifest.json','SHA256SUMS'}
FORBIDDEN_PARTS={'.git','.venv','node_modules','__pycache__','.wrangler','.pytest_cache','validation'}
FORBIDDEN_NAMES={'AGENTS.md','.env','.dev.vars','.DS_Store','test-targeted.mjs','inspect_input_keys.py'}
SECRET=re.compile(rb'(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
def check(name,data):
 parts=Path(name).parts
 if any(p in FORBIDDEN_PARTS for p in parts) or Path(name).name in FORBIDDEN_NAMES:raise ValueError('Forbidden release path: '+name)
 if '..' in parts or name.startswith(('/',chr(92))):raise ValueError('Unsafe archive path: '+name)
 if name.endswith(('.pyc','.log','.map')):raise ValueError('Development output: '+name)
 if SECRET.search(data):raise ValueError('Possible credential in '+name)
 if ('tests' in parts or '__tests__' in parts) and 'third_party' not in parts:raise ValueError('Development tests in '+name)
def verify(folder):
 actual={p.name for p in folder.iterdir() if p.is_file()}
 if actual!=EXPECTED:raise ValueError('Unexpected release assets: '+str(sorted(actual^EXPECTED)))
 sums={}
 for line in (folder/'SHA256SUMS').read_text().splitlines():
  digest,name=line.split('  ',1);sums[name]=digest
 if set(sums)!=EXPECTED-{'SHA256SUMS'}:raise ValueError('Incomplete SHA256SUMS')
 for name,digest in sums.items():
  if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=digest:raise ValueError('Checksum mismatch: '+name)
 entries=0
 for name in sorted(EXPECTED):
  p=folder/name;data=p.read_bytes();check(name,data)
  if name.endswith(('.zip','.whl')):
   with zipfile.ZipFile(p) as z:
    if z.testzip() is not None:raise ValueError('Archive CRC mismatch: '+name)
    for info in z.infolist():
     if info.is_dir():continue
     check(info.filename,z.read(info));entries+=1
 manifest=json.loads((folder/'release-manifest.json').read_text())
 if manifest['version']!=VERSION or not re.fullmatch('[a-f0-9]{40}',manifest.get('source_commit','')):raise ValueError('Invalid source identity')
 expected_commit=os.environ.get('GITHUB_SHA') or os.environ.get('COMPUTER_BRIDGE_SOURCE_REVISION')
 if expected_commit and manifest['source_commit']!=expected_commit:raise ValueError('Source commit does not match expected build revision')
 for item in manifest['artifacts']:
  p=folder/item['file']
  if item['version']!=VERSION or item['size']!=p.stat().st_size or item['sha256']!=hashlib.sha256(p.read_bytes()).hexdigest():raise ValueError('Manifest mismatch: '+item['file'])
 if {i['file'] for i in manifest['artifacts']}!=EXPECTED-{'SHA256SUMS','release-manifest.json',f'computer-bridge-{VERSION}-install.zip'}:raise ValueError('Incomplete component manifest')
 print(json.dumps({'version':VERSION,'assets':len(EXPECTED),'archive_files_checked':entries,'source_commit':manifest['source_commit'],'sha256_verified':True}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);verify(parser.parse_args().folder)
