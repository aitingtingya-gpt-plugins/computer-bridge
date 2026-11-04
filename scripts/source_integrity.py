"""Verify immutable upstream inputs and forbid packaged DSH module dependencies."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'src/computer_bridge/native'
for manifest, folder in [('UPSTREAM.json', 'dsh'), ('DSH_TOOLS.json', 'dsh-tools')]:
    value = json.loads((NATIVE / manifest).read_text(encoding='utf-8'))
    for path, digest in value['files'].items():
        data = (NATIVE / 'third_party' / folder / path).read_bytes()
        assert hashlib.sha256(data).hexdigest() == digest, f'Upstream source changed: {path}'
    print(f'{folder}: {len(value["files"])} immutable source files verified')
lock = json.loads((NATIVE / 'package-lock.json').read_text(encoding='utf-8'))
assert not any('/@deepseek-ai/dsh-' in key for key in lock['packages']), 'DSH npm module detected'
for path in NATIVE.glob('*.mjs'):
    if path.name.startswith('build'): continue
    import re
    assert not re.search(r'(?:from\s*|import\s*\()([\"\x27])@deepseek-ai/dsh-', path.read_text(encoding='utf-8')), path
print('No DSH npm runtime dependencies')
