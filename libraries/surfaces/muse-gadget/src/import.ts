import {identity} from './pairing.js';

/** Portable handoff from the official Linux SDK. Never expose this object in app state. */
export function parsePairingExport(raw:unknown) {
  const fail=():never=>{throw Error('Invalid Muse pairing file. Export it again with export-pairing.py.');};
  const object=(v:unknown):Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:fail();
  const text=(v:unknown,max=16384):string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\s\x00-\x1f\x7f]/.test(v)?v:fail();
  const value=object(raw);
  if(value.format!=='agent-squad-muse-pairing'||value.version!==1)fail();
  const mac=object(value.identity).mac;
  if(typeof mac!=='string'||!/^([a-f0-9]{2}:){5}[a-f0-9]{2}$/.test(mac))fail();
  const device=identity(mac),pairing=object(value.pairing);
  // No user-controlled credential destinations: imports only contact Muse.
  const api=pairing.api_url_v2||'https://api.muse.ai';
  if(typeof api!=='string'||!/^https:\/\/api\.muse\.ai\/?$/.test(api))fail();
  const host=pairing.noise_host||'hatch.metaaivm.com';
  if(typeof host!=='string'||host.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*metaaivm\.com$/.test(host))fail();
  return {device,sdkToken:text(value.sdk_token,4096),credentials:{
    access_token:text(pairing.access_token),refresh_token:text(pairing.refresh_token),
    api_url_v2:'https://api.muse.ai',noise_host:host,updated:Date.now(),
  }};
}
