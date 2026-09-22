#!/usr/bin/env python3
"""Use a persistent Apple signing identity, including for the bundled runtime."""
import os
from pathlib import Path
import re
import subprocess
import sys

app = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parent.parent
pin = root / '.build' / 'signing-identity'
identity = os.environ.get('AGENT_SQUAD_SIGNING_IDENTITY')
release = os.environ.get('AGENT_SQUAD_RELEASE') == '1'
if os.environ.get('AGENT_SQUAD_ADHOC') == '1':
    identity = '-'
elif not identity and not release:
    if pin.exists():
        identity = pin.read_text().strip()
    else:
        listing = subprocess.check_output(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
        candidates = re.findall(r'([0-9A-F]{40}) "((?:Apple Development|Developer ID Application):[^\"]+)"', listing)
        if not candidates:
            sys.exit('No Apple signing identity is accessible. Build with Keychain access and an Apple Development identity. For an explicitly disposable build only, set AGENT_SQUAD_ADHOC=1.')
        identity = candidates[0][0]

if release:
    listing = subprocess.check_output(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
    candidates = re.findall(r'([0-9A-F]{40}) "(Developer ID Application:[^\"]+)"', listing)
    matches = [(fingerprint, name) for fingerprint, name in candidates if not identity or identity in (fingerprint, name)]
    if len(matches) != 1:
        sys.exit('Release requires one selected Developer ID Application identity. Set AGENT_SQUAD_SIGNING_IDENTITY if more than one is installed.')
    identity = matches[0][0]

def sign(path, identifier=None, entitlements=None):
    command = ['/usr/bin/codesign', '--force', '--sign', identity]
    if release:
        command += ['--options', 'runtime', '--timestamp']
        if entitlements:
            command += ['--entitlements', str(root / 'macos/Entitlements' / entitlements)]
    if identifier:
        command += ['--identifier', identifier]
    subprocess.run(command + [str(path)], check=True)

# Sign nested libraries before their containing bundle; avoid --deep signing.
for library in sorted((app / 'Contents/Resources/node_modules').rglob('*')):
    if library.is_file() and library.suffix in ('.node', '.dylib'):
        sign(library)
sign(app / 'Contents/Resources/runtime/node', 'com.jamiepinheiro.agentsquad.runtime.node', 'Node.plist')
sign(app, 'com.jamiepinheiro.agentsquad', 'App.plist')
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
if identity != '-' and not release:
    pin.parent.mkdir(parents=True, exist_ok=True)
    pin.write_text(identity + '\n')
print('Signed with a persistent Apple identity.' if identity != '-' else 'Ad-hoc build: privacy permissions may not survive rebuilding.')
