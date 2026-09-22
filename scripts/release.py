#!/usr/bin/env python3
"""Resumable Developer ID / notarized DMG release workflow. Credentials stay in Keychain."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('step', choices=['build', 'submit-app', 'package', 'submit-dmg', 'finish'])
parser.add_argument('--profile', default='agent-squad-notary', help='notarytool Keychain profile')
args = parser.parse_args()
os.chdir(root)
os.environ.setdefault('DEVELOPER_DIR', '/Library/Developer/CommandLineTools')
app = root / 'dist/Agent Squad.app'
work = root / '.build/release'
work.mkdir(parents=True, exist_ok=True)
state_file = work / 'notarization.json'
state = json.loads(state_file.read_text()) if state_file.exists() else {}
version = json.loads((root / 'package.json').read_text())['version']
arch = os.uname().machine
zip_path = work / 'Agent-Squad.zip'
dmg = root / f'dist/Agent-Squad-{version}-{arch}.dmg'

def run(*command):
    subprocess.run(command, check=True)

def save():
    state_file.write_text(json.dumps(state, indent=2) + '\n')
    state_file.chmod(0o600)

def accepted(kind):
    artifact = zip_path if kind == 'app' else dmg
    submission = state.get(kind)
    if not submission:
        raise SystemExit(f'Submit {kind} before continuing.')
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    if digest not in (submission['sha256'], submission.get('stapled_sha256')):
        raise SystemExit(f'{kind} changed since submission. Submit the current artifact before continuing.')
    info = json.loads(subprocess.check_output(['xcrun', 'notarytool', 'info', state[kind]['id'], '--keychain-profile', args.profile, '--output-format', 'json'], text=True))
    if info['status'] != 'Accepted':
        raise SystemExit(f"{kind}: {info['status']}. Inspect the existing submission; do not resubmit while it is in progress.")

def require_distribution_signature(bundle=app):
    run('codesign', '--verify', '--deep', '--strict', str(bundle))
    inspection = subprocess.run(['codesign', '-dv', '--verbose=4', str(bundle)], capture_output=True, text=True, check=True).stderr
    if 'Authority=Developer ID Application:' not in inspection or 'runtime' not in inspection or 'Timestamp=' not in inspection:
        raise SystemExit('Expected a timestamped Developer ID build with hardened runtime.')

if args.step == 'build':
    if not (root / 'LICENSE').exists():
        raise SystemExit('Add the project license before building a public release.')
    env = dict(os.environ, AGENT_SQUAD_RELEASE='1')
    subprocess.run(['npm', 'run', 'app'], env=env, check=True)
    require_distribution_signature()
    if zip_path.exists(): zip_path.unlink()
    run('ditto', '-c', '-k', '--keepParent', '--sequesterRsrc', str(app), str(zip_path))
elif args.step.startswith('submit-'):
    kind = args.step.removeprefix('submit-')
    artifact = zip_path if kind == 'app' else dmg
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    if state.get(kind, {}).get('sha256') == digest:
        print(f"Existing {kind} submission: {state[kind]['id']}")
    else:
        require_distribution_signature()
        result = json.loads(subprocess.check_output(['xcrun', 'notarytool', 'submit', str(artifact), '--keychain-profile', args.profile, '--output-format', 'json'], text=True))
        state[kind] = {'id': result['id'], 'sha256': digest}
        save()
        print(f"Submitted {kind}: {result['id']}. Check using notarytool info before the next step.")
elif args.step == 'package':
    accepted('app')
    stage = work / 'image'
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(exist_ok=True)
    # Package the exact submitted archive, even if the development app was rebuilt.
    run('ditto', '-x', '-k', str(zip_path), str(stage))
    packaged_app = stage / app.name
    require_distribution_signature(packaged_app)
    run('xcrun', 'stapler', 'staple', str(packaged_app))
    run('xcrun', 'stapler', 'validate', str(packaged_app))
    applications = stage / 'Applications'
    if not applications.is_symlink(): applications.symlink_to('/Applications')
    processor = 'Apple Silicon' if arch == 'arm64' else 'Intel'
    (stage / 'Install.txt').write_text(f'Drag Agent Squad into Applications, then open it.\nRequires macOS 14 or later on {processor}.\nConfigure connectors in Settings. No Node installation is needed.\n')
    run('hdiutil', 'create', '-ov', '-format', 'UDZO', '-volname', 'Agent Squad', '-srcfolder', str(stage), str(dmg))
    identity = os.environ.get('AGENT_SQUAD_SIGNING_IDENTITY')
    if not identity: raise SystemExit('Set AGENT_SQUAD_SIGNING_IDENTITY to the Developer ID used for the app.')
    run('codesign', '--force', '--timestamp', '--sign', identity, str(dmg))
elif args.step == 'finish':
    accepted('dmg')
    run('xcrun', 'stapler', 'staple', str(dmg))
    run('xcrun', 'stapler', 'validate', str(dmg))
    run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(work / 'image' / app.name))
    digest = hashlib.sha256(dmg.read_bytes()).hexdigest()
    state['dmg']['stapled_sha256'] = digest
    save()
    (root / 'dist/SHA256SUMS').write_text(f'{digest}  {dmg.name}\n')
    print(f'Ready for GitHub Releases: {dmg.name} and SHA256SUMS')
