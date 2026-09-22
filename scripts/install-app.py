#!/usr/bin/env python3
"""Install a verified build at one stable Applications location."""
from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
source = root / 'dist' / 'Agent Squad.app'
target = Path(os.environ.get('AGENT_SQUAD_INSTALL_DIR', '/Applications')) / 'Agent Squad.app'
staging = target.parent / '.AgentSquad-installing.bundle'
backup = target.parent / '.AgentSquad-previous.bundle'
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(source)], check=True)
inspection = subprocess.run(['/usr/bin/codesign', '-d', '-r-', str(source)], text=True, capture_output=True, check=True)
signature = inspection.stdout + inspection.stderr
if 'anchor apple' not in signature:
    sys.exit('Install requires an Apple-signed build. Run npm run app with an accessible signing identity first.')
with (source / 'Contents/Info.plist').open('rb') as f:
    if plistlib.load(f).get('CFBundleIdentifier') != 'com.jamiepinheiro.agentsquad':
        sys.exit('Unexpected source bundle identifier.')
# Stop before replacing anything if the installed or development copy is running.
processes = subprocess.check_output(['/bin/ps', '-axo', 'pid=,comm='], text=True)
for line in processes.splitlines():
    if line.strip().endswith('/Contents/MacOS/AgentSquad'):
        sys.exit('Quit Agent Squad from its menu bar before installing this update. The existing app is unchanged.')
state = Path.home() / 'Library/Application Support/Agent Squad/state.json'
if state.exists() and any(s.get('status') == 'working' for s in json.loads(state.read_text()).get('sessions', [])):
    sys.exit('Saved work is still marked active. Open Agent Squad and finish or cancel it before installing.')
if staging.exists() or backup.exists():
    sys.exit('An earlier installation staging folder exists. Inspect it before retrying.')
if target.exists():
    with (target / 'Contents/Info.plist').open('rb') as f:
        if plistlib.load(f).get('CFBundleIdentifier') not in ('com.jamiepinheiro.agentsquad', 'com.agentsquad.app'):
            sys.exit('Refusing to replace an unrelated application.')
try:
    subprocess.run(['/usr/bin/ditto', str(source), str(staging)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(staging)], check=True)
    # The installed identity owns the old login item, so unregister it before replacement.
    preparation_app = target if target.exists() else source
    subprocess.run([str(preparation_app / 'Contents/MacOS/AgentSquad'), '--prepare-install'], check=True)
    if target.exists():
        target.rename(backup)
    try:
        staging.rename(target)
    except Exception:
        if backup.exists(): backup.rename(target)
        raise
    if backup.exists(): shutil.rmtree(backup)
except Exception:
    if staging.exists(): shutil.rmtree(staging)
    raise
print(f'Installed: {target}')
