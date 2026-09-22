import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function readSecret(account:string):Promise<string|undefined> {
  try {
    if(process.env.AGENT_SQUAD_HELPER) {
      const result=await exec(process.env.AGENT_SQUAD_HELPER,['--credential-read',account],{timeout:30000});
      return JSON.parse(result.stdout).value ?? undefined;
    }
    for(const service of ['com.jamiepinheiro.agentsquad.credentials','com.agentsquad.credentials']) {
      try { return (await exec('/usr/bin/security',['find-generic-password','-s',service,'-a',account,'-w'])).stdout.trim(); } catch {}
    }
    return undefined; }
  catch { return undefined; }
}
