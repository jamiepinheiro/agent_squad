#!/usr/bin/env python3
"""Resumable Developer ID / notarized DMG release workflow. Credentials stay in Keychain."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

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

build_file = work / 'build-manifest.json'

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def release_manifest():
    if not build_file.exists():
        raise SystemExit('Build the release and corresponding source first.')
    build = json.loads(build_file.read_text())
    if build['version'] != version or build['app_sha256'] != sha256(zip_path):
        raise SystemExit('App archive no longer matches the release manifest. Rebuild the release.')
    source = root / 'dist' / build['source']['file']
    if not source.exists() or sha256(source) != build['source']['sha256']:
        raise SystemExit('The matching source archive is missing or has changed.')
    return build

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
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], text=True).strip():
        raise SystemExit('Commit the audited source before building a release.')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    env = dict(os.environ, AGENT_SQUAD_RELEASE='1', AGENT_SQUAD_SOURCE_REVISION=revision)
    subprocess.run(['npm', 'run', 'app'], env=env, check=True)
    require_distribution_signature()
    if zip_path.exists(): zip_path.unlink()
    run('ditto', '-c', '-k', '--keepParent', '--sequesterRsrc', str(app), str(zip_path))
    run(sys.executable, str(root / 'scripts/prepare-source.py'))
    source = json.loads((work / 'source-manifest.json').read_text())
    if source['revision'] != revision:
        raise SystemExit('The checkout changed during the build. Rebuild from a stable revision.')
    build_file.write_text(json.dumps({'version': version, 'revision': revision, 'arch': arch,
        'app_sha256': sha256(zip_path), 'source': source}, indent=2) + '\n')
elif args.step.startswith('submit-'):
    release_manifest()
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
    release_manifest()
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
    build = release_manifest()
    accepted('dmg')
    run('xcrun', 'stapler', 'staple', str(dmg))
    run('xcrun', 'stapler', 'validate', str(dmg))
    run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(work / 'image' / app.name))
    digest = hashlib.sha256(dmg.read_bytes()).hexdigest()
    state['dmg']['stapled_sha256'] = digest
    save()
    public_manifest = root / 'dist/RELEASE-MANIFEST.json'
    public_manifest.write_text(json.dumps({'version': version, 'revision': build['revision'],
        'architecture': arch, 'minimum_macos': '14.0', 'installer': dmg.name,
        'installer_sha256': digest, 'source': build['source']}, indent=2) + '\n')
    source = root / 'dist' / build['source']['file']
    artifacts = [dmg, source, public_manifest]
    (root / 'dist/SHA256SUMS').write_text(''.join(f'{sha256(path)}  {path.name}\n' for path in artifacts))
    print('Ready for GitHub Releases: ' + ', '.join(path.name for path in artifacts) + ', SHA256SUMS')
