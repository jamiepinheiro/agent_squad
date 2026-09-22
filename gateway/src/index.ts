import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Kernel, application, TunnelSchema, messageOf } from '@agent-squad/kernel';
import { createSurfaces } from './surfaces.js';
import { readSecret } from './secrets.js';
import { Tunnel } from './tunnel.js';

const directory=process.env.AGENT_SQUAD_DATA_DIR ?? join(homedir(),'Library','Application Support','Agent Squad');
const kernel=new Kernel({directory,surfaces:createSurfaces({directory,helper:process.env.AGENT_SQUAD_HELPER ?? '',secret:readSecret})});
const {store,protocol}=kernel;
function storedToken(name:string) {
  const file=join(directory,name);
  if(existsSync(file)) return readFileSync(file,'utf8').trim();
  const value=randomBytes(32).toString('hex');writeFileSync(file,value,{mode:0o600});return value;
}
const controlToken=process.env.AGENT_SQUAD_CONTROL_TOKEN ?? storedToken('control-token');
const tunnel=new Tunnel(directory,readSecret);
let endpoint='';
const app=application(protocol,controlToken,()=>({
  ...kernel.snapshot(),
  tunnelConfig:store.state.tunnel ?? null,tunnel:{status:tunnel.status,error:tunnel.error,healthURL:tunnel.healthURL},
  endpoint,
}),async input=>{
  switch(input.action) {
    case 'saveTunnel':store.state.tunnel=TunnelSchema.parse(input.config);store.save();return;
    case 'startTunnel':if(!store.state.tunnel) throw Error('Configure a tunnel first.');return tunnel.start(store.state.tunnel,endpoint);
    case 'stopTunnel':return tunnel.stop();
    default:return kernel.action(input);
  }
},(process.env.AGENT_SQUAD_TRUSTED_HOSTS ?? '').split(',').map(host=>host.trim().toLowerCase()).filter(Boolean));
const port=Number(process.env.AGENT_SQUAD_PORT ?? 9847);
const listener=app.listen(port,'127.0.0.1',()=>{
  const address=listener.address();if(!address || typeof address==='string') throw Error('No listener address.');
  endpoint=`http://127.0.0.1:${address.port}/mcp`;
  process.stdout.write(JSON.stringify({port:address.port})+'\n');
  if(store.state.tunnel?.autoConnect) void tunnel.start(store.state.tunnel,endpoint).catch(e=>{tunnel.status='failed';tunnel.error=messageOf(e);});
  void kernel.start().catch(error=>process.stderr.write(messageOf(error)+'\n'));
});
listener.on('error',error=>{process.stderr.write(messageOf(error)+'\n');process.exit(1);});
let stopping=false;
async function shutdown() {
  if(stopping) return;stopping=true;
  listener.close();listener.closeAllConnections();
  await Promise.allSettled([kernel.stop(),tunnel.stop()]);process.exit(0);
}
process.on('SIGTERM',()=>{void shutdown();});process.on('SIGINT',()=>{void shutdown();});
if(process.env.AGENT_SQUAD_MANAGED==='1') {process.stdin.resume();process.stdin.on('end',()=>{void shutdown();});}
