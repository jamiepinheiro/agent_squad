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
notices = ['# Bundled third-party software', '',
           'Upstream license files are preserved beside each dependency in node_modules. Packages that publish none are covered at the end of this file.',
           'Node.js notices are in runtime/LICENSE.', '', 'The bundled Baileys library is modified by Agent Squad; see the repository compatibility patch.', '']
MIT = ('Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), '
       'to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, '
       'and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n'
       'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n'
       'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, '
       'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER '
       'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.')
def holder(item):
    author = item.get('author')
    name = author.get('name') if isinstance(author, dict) else author
    return name.split('<')[0].split('(')[0].strip() if isinstance(name, str) and name.strip() else f"the {item['name']} authors"
unlicensed = []
for p in sorted(modules.rglob('package.json')):
    if p.is_symlink(): continue
    try:
        item = json.loads(p.read_text())
    except (ValueError, UnicodeError): continue
    # Private package.json files are scaffolding inside another package, not dependencies.
    if item.get('name') and item.get('version') and not item.get('private'):
        notices.append(f"- {item['name']} {item['version']} — {item.get('license', 'see package license files')}")
        if not any(f.name.lower().startswith(('license', 'licence', 'copying', 'notice')) for f in p.parent.iterdir()):
            unlicensed.append(item)
if unlicensed:
    notices += ['', '## Packages without an upstream license file', '']
    for item in unlicensed:
        notices += [f"### {item['name']} {item['version']}", '']
        if item.get('license') == 'MIT':
            notices += ['MIT License', '', f'Copyright (c) {holder(item)}', '', MIT, '']
        else:
            repository = item.get('repository')
            url = repository.get('url') if isinstance(repository, dict) else repository
            notices += [f"License: {item.get('license', 'unspecified')}. See {url or 'the package source'}.", '']
(resources / 'THIRD-PARTY-NOTICES.md').write_text('\n'.join(notices) + '\n')
shutil.copy2(root / 'docs/licenses/GPL-3.0.txt', resources / 'GPL-3.0.txt')
shutil.copy2(root / 'docs/distribution-licensing.md', resources / 'DISTRIBUTION-LICENSING.md')
