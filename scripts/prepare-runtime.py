#!/usr/bin/env python3
"""Download a pinned, checksummed, portable Node runtime for macOS releases."""
import hashlib
import platform
from pathlib import Path
import subprocess
import urllib.request

root = Path(__file__).resolve().parent.parent
version = '22.23.2'
arch = {'arm64': 'arm64', 'x86_64': 'x64'}[platform.machine()]
name = f'node-v{version}-darwin-{arch}'
directory = root / '.build' / 'runtime'
directory.mkdir(parents=True, exist_ok=True)
archive = directory / (name + '.tar.gz')
base = f'https://nodejs.org/dist/v{version}/'
checksums = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=30).read().decode()
expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == archive.name)
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    with urllib.request.urlopen(base + archive.name, timeout=60) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Node archive checksum mismatch.')
subprocess.run(['tar', '-xzf', str(archive), '-C', str(directory)], check=True)
print(directory / name / 'bin' / 'node')
