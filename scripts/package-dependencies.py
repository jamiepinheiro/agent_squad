#!/usr/bin/env python3
"""Install only lockfile production dependencies into the app's isolated resources."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
resources = Path(sys.argv[1]).resolve()
# npm lifecycle scripts are not needed by these runtime packages. The one audited
# compatibility patch is applied explicitly after the isolated install.
# Baileys' image/audio transformation peers are unused by our text-only sender.
# Receiving image bytes does not require those native transformation libraries.
subprocess.run(['npm', 'ci', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=resources, check=True)
patch = resources / 'libraries/surfaces/whatsapp/scripts/patch-baileys.mjs'
patch.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(root / 'libraries/surfaces/whatsapp/scripts/patch-baileys.mjs', patch)
subprocess.run([str(resources / 'runtime/node'), str(patch)], cwd=resources, check=True)
shutil.rmtree(patch.parent)
modules = resources / 'node_modules'
for p in sorted(modules.rglob('*'), key=lambda p: len(p.parts), reverse=True):
    if p.is_symlink():
        if not p.resolve().is_relative_to(resources):
            raise SystemExit(f'External dependency link: {p.relative_to(resources)}')
    elif p.is_dir() and p.name in ('test', 'tests', '__tests__', '.github', '.git', '__pycache__'):
        shutil.rmtree(p)
    elif p.is_file() and (p.name == '.DS_Store' or p.suffix in ('.map', '.tsbuildinfo', '.log')):
        p.unlink()
notices = ['# Bundled third-party software', '', 'Upstream license files are preserved beside each dependency in node_modules.',
           'Node.js notices are in runtime/LICENSE.', '', 'The bundled Baileys decoder is modified by Agent Squad; see the repository compatibility patch.', '']
for p in sorted(modules.rglob('package.json')):
    if p.is_symlink(): continue
    try:
        item = json.loads(p.read_text())
    except (ValueError, UnicodeError): continue
    if item.get('name') and item.get('version'):
        notices.append(f"- {item['name']} {item['version']} — {item.get('license', 'see package license files')}")
(resources / 'THIRD-PARTY-NOTICES.md').write_text('\n'.join(notices) + '\n')
shutil.copy2(root / 'docs/licenses/GPL-3.0.txt', resources / 'GPL-3.0.txt')
shutil.copy2(root / 'docs/distribution-licensing.md', resources / 'DISTRIBUTION-LICENSING.md')
