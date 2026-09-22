#!/usr/bin/env python3
"""Archive committed app source and the exact bundled dependency sources for a release."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--resources', type=Path, default=root / 'dist/Agent Squad.app/Contents/Resources')
args = parser.parse_args()
resources = args.resources.resolve()
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=root, text=True).strip():
    raise SystemExit('Commit the audited source before preparing a release source archive.')
lock = json.loads((resources / 'package-lock.json').read_text())
if (resources / 'package-lock.json').read_bytes() != (root / 'package-lock.json').read_bytes():
    raise SystemExit('The bundled dependency lockfile differs from the committed source.')
version = json.loads((root / 'package.json').read_text())['version']
cache = root / '.build/source-downloads'
cache.mkdir(parents=True, exist_ok=True)
source_overrides = json.loads((root / 'scripts/dependency-sources.json').read_text())


def download(url, integrity=None):
    path = cache / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Agent-Squad-release'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
        except Exception as error:
            raise RuntimeError(f'Could not download {url}: {error}') from error
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
            output.write(data)
            temporary = Path(output.name)
        temporary.replace(path)
    data = path.read_bytes()
    if integrity:
        algorithm, encoded = integrity.split()[0].split('-', 1)
        if algorithm not in ('sha512', 'sha384', 'sha256', 'sha1'):
            raise ValueError('Unsupported dependency integrity algorithm')
        if hashlib.new(algorithm, data).digest() != base64.b64decode(encoded):
            path.unlink()
            raise ValueError('Dependency archive integrity mismatch')
    return path


def github_source(repository, commit):
    if isinstance(repository, dict): repository = repository.get('url', '')
    if not isinstance(repository, str) or not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        return None
    match = re.search(r'github\.com[:/]([\w.-]+)/([\w.-]+)', repository)
    if not match: return None
    owner, repo = match.groups()
    if repo.endswith('.git'): repo = repo[:-4]
    return f'https://codeload.github.com/{owner}/{repo}/tar.gz/{commit}'


def package_sources(entry):
    location, item = entry
    manifest = json.loads((resources / location / 'package.json').read_text())
    name, package_version = manifest['name'], manifest['version']
    resolved = item['resolved']
    override = source_overrides.get(name + '@' + package_version, {})
    row = {'name': name, 'version': package_version, 'installed_path': location, 'license': manifest.get('license'), 'archives': []}
    if resolved.startswith('https://registry.npmjs.org/'):
        metadata_url = f'https://registry.npmjs.org/{urllib.parse.quote(name, safe="")}/{urllib.parse.quote(package_version, safe="")}'
        metadata = json.loads(download(metadata_url).read_text())
        archives = [('npm', resolved, item.get('integrity'))]
        source = github_source(override.get('repository', metadata.get('repository', manifest.get('repository'))), override.get('revision', metadata.get('gitHead')))
        if override.get('published_source'): source = None
        if source: archives.append(('upstream', source, None))
        row['upstream_revision'] = override.get('revision', metadata.get('gitHead'))
        if override: row['source_review'] = override
        row['repository'] = metadata.get('repository', manifest.get('repository'))
    else:
        commit = resolved.rsplit('#', 1)[-1]
        source = github_source(resolved, commit)
        if not source: raise ValueError(f'Cannot identify pinned dependency source: {name}')
        archives = [('upstream', source, None)]
        row['upstream_revision'] = commit
    for kind, url, integrity in archives:
        try:
            path = download(url, integrity)
        except RuntimeError as error:
            if kind == 'upstream' and row['archives'] and isinstance(error.__cause__, urllib.error.HTTPError) and error.__cause__.code == 404:
                # Some historic registry revisions have disappeared upstream. Keep
                # the verified npm source and flag it for source-coverage review.
                row['unavailable_upstream'] = url
                continue
            raise
        data = path.read_bytes()
        # Read archive headers without extracting or executing upstream files.
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            if not archive.getmembers(): raise ValueError(f'Empty source archive: {name}')
            if kind == 'upstream' and override.get('package_file'):
                suffix = '/' + override['package_file']
                candidates = [m for m in archive if m.isfile() and m.name.split('/', 1)[-1] == override['package_file']]
                if len(candidates) != 1: raise ValueError(f'Cannot verify upstream package metadata: {name}')
                upstream = json.load(archive.extractfile(candidates[0]))
                if (upstream.get('name'), upstream.get('version')) != (name, package_version):
                    raise ValueError(f'Upstream source version mismatch: {name}')
        digest = hashlib.sha256(data).hexdigest()
        row['archives'].append({'kind': kind, 'url': url, 'sha256': digest, 'file': f'dependencies/{digest}.tar.gz'})
    if not any(a['kind'] == 'upstream' for a in row['archives']) and not override.get('published_source'):
        raise ValueError(f'Review original source coverage for {name}@{package_version} and add a pinned source mapping.')
    return row


entries = [(location, item) for location, item in lock['packages'].items()
           if item.get('resolved') and not item.get('link') and (resources / location / 'package.json').is_file()]
with ThreadPoolExecutor(max_workers=6) as executor:
    packages = list(executor.map(package_sources, entries))
packages.sort(key=lambda item: (item['name'], item['version'], item['installed_path']))
manifest = {'version': version, 'revision': revision, 'packages': packages}
output = root / f'dist/Agent-Squad-{version}-source.tar.gz'
output.parent.mkdir(exist_ok=True)
source_tar = subprocess.check_output(['git', 'archive', '--format=tar', '--prefix=agent-squad/', revision], cwd=root)

def add_bytes(archive, name, data):
    member = tarfile.TarInfo(name)
    member.size = len(data)
    member.mode = 0o644
    archive.addfile(member, io.BytesIO(data))

with tarfile.open(output, 'w:gz') as output_archive:
    with tarfile.open(fileobj=io.BytesIO(source_tar)) as source_archive:
        for member in source_archive:
            output_archive.addfile(member, source_archive.extractfile(member) if member.isfile() else None)
    add_bytes(output_archive, 'SOURCE-MANIFEST.json', (json.dumps(manifest, indent=2) + '\n').encode())
    add_bytes(output_archive, 'README.txt', (
        f'Agent Squad {version}\nSource revision: {revision}\n\n'
        'Original app source and build instructions are in agent-squad/.\n'
        'Dependency archives are mirrored here, not merely linked to a remote server.\n'
        'SOURCE-MANIFEST.json maps each installed dependency to its archives, exact version,\n'
        'upstream revision when supplied by its publisher, license and SHA-256 checksum.\n'
        'npm archives preserve published source and license files; upstream archives also\n'
        'preserve original sources/build files where a pinned repository revision is available.\n'
        'The Baileys modification is in agent-squad/libraries/surfaces/whatsapp/scripts/.\n'
        'See agent-squad/docs/distribution-licensing.md for the combined GPLv3 distribution.\n'
        'No personal runtime data, credentials or local verification scripts are included.\n'
    ).encode())
    added = set()
    for package in packages:
        for entry in package['archives']:
            if entry['file'] in added: continue
            added.add(entry['file'])
            output_archive.add(download(entry['url']), arcname=entry['file'], recursive=False)
print(f'Prepared {output.name}: {len(packages)} dependencies, {len(added)} source archives, revision {revision}')
# Used by release.py to bind the binary, source and published revision together.
(root / '.build/release').mkdir(exist_ok=True)
(root / '.build/release/source-manifest.json').write_text(json.dumps({
    'revision': revision, 'version': version, 'file': output.name,
    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'packages': len(packages),
}, indent=2) + '\n')
