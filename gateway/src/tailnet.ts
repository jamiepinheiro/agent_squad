import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);

/** Trust this Mac's own Tailscale hostname, never a hostname supplied by a request. */
export async function tailnetHosts(port:number):Promise<string[]> {
  for(const executable of ['/usr/local/bin/tailscale','/opt/homebrew/bin/tailscale','/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const {stdout}=await run(executable,['status','--json'],{timeout:3000,maxBuffer:2*1024*1024});
      const status=JSON.parse(stdout);
      const name=String(status.Self?.DNSName ?? '').replace(/\.$/,'').toLowerCase();
      if(status.BackendState==='Running' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(name)) return [name,`${name}:443`,`${name}:${port}`];
    } catch { /* Tailscale is optional; keep loopback-only hosts if unavailable. */ }
  }
  return [];
}
