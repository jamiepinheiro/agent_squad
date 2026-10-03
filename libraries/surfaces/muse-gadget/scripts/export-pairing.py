#!/usr/bin/env python3
"""Export a stopped Muse Linux device for import into Agent Squad. No network calls."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def export_pairing(directory, destination):
    def read(name):
        with (directory / name).open('rb') as file:
            raw = file.read(65537)
        if len(raw) > 65536:
            raise ValueError('Pairing input is too large.')
        return raw.decode('utf-8')

    device = json.loads(read('identity.json'))
    pairing = json.loads(read('pairing.json'))
    token = (os.environ.get('MUSEGADGET_SDK_TOKEN') or read('sdk_token')).strip()
    if not isinstance(device, dict) or not re.fullmatch(r'(?:[a-f0-9]{2}:){5}[a-f0-9]{2}', device.get('mac', '')):
        raise ValueError('Missing or invalid device identity. Pair the Pi with Muse first.')
    if not isinstance(pairing, dict):
        raise ValueError('Invalid pairing state.')
    def secret(value):
        return isinstance(value, str) and 0 < len(value) <= 16384 and not re.search(r'[\s\x00-\x1f\x7f]', value)
    if not all(secret(pairing.get(key)) for key in ('access_token', 'refresh_token')) or not secret(token):
        raise ValueError('Missing pairing credentials or SDK token. Pair the Pi with Muse first.')
    data = {'format': 'agent-squad-muse-pairing', 'version': 1,
            'identity': {'mac': device['mac']}, 'sdk_token': token,
            'pairing': {key: pairing.get(key, '') for key in ('access_token', 'refresh_token', 'api_url_v2', 'noise_host')}}
    encoded = (json.dumps(data, indent=2) + '\n').encode()
    if len(encoded) > 65536:
        raise ValueError('Export is too large.')
    # Exclusive creation also refuses symlink targets and accidental overwrites.
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as file:
        file.write(encoded)
        file.flush()
        os.fsync(file.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=Path(os.environ.get('MUSEGADGET_STATE_DIR', '/var/lib/musegadget')))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Refuse a running or transitioning device. Keep it disabled after exporting.
    state = subprocess.run(['systemctl', 'show', 'musegadget.service', '--property=ActiveState', '--value'], capture_output=True, text=True)
    if state.returncode != 0 or state.stdout.strip() not in ('inactive', 'failed'):
        parser.error('Stop Muse first: sudo systemctl disable --now musegadget.service')
    try:
        export_pairing(args.state_dir, args.output)
    except (OSError, ValueError, TypeError):
        sys.exit('Export failed. Check the pairing files and output location; existing files are never overwritten. No credentials were printed.')
    print('Pairing exported. Keep the Pi service stopped. Transfer the file privately, import it into Agent Squad, then delete both transfer copies.')


if __name__ == '__main__':
    main()
