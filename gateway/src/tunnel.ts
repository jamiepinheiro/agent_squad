import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretReader, TunnelConfig } from '@agent-squad/kernel';

export class Tunnel {
  status='disconnected'; error:string|null=null; healthURL:string|null=null;
  private child?:ChildProcess; private timer?:NodeJS.Timeout;
  constructor(private directory:string,private secret:SecretReader) {}
  async start(config:TunnelConfig,endpoint:string) {
    await this.stop();
    const key=await this.secret('tunnel');
    if(!key) throw Error('Save a tunnel runtime key in ChatGPT settings first.');
    const healthFile=join(this.directory,'tunnel-health.url');rmSync(healthFile,{force:true});
    this.status='connecting';this.error=null;
    // Pass secrets via environment references, never command arguments or saved profiles.
    const child=spawn(config.executable,['run','--control-plane.tunnel-id',config.tunnelId,
      '--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--mcp.server-url',endpoint,
      '--health.listen-addr','127.0.0.1:0','--health.url-file',healthFile],{
      env:{PATH:process.env.PATH,HOME:process.env.HOME,CONTROL_PLANE_API_KEY:key},
      stdio:['ignore','pipe','pipe'],
    });
    this.child=child;
    // Drain output without retaining credentials or message content from third-party logs.
    child.stdout?.resume();child.stderr?.resume();
    child.on('error',error=>{if(this.child===child){this.error=error.message;this.status='failed';}});
    child.on('exit',code=>{if(this.child===child){clearInterval(this.timer);this.child=undefined;this.status='failed';this.error=`Tunnel stopped (exit ${code}). Check the executable, tunnel ID, and runtime-key permissions.`;}});
    this.timer=setInterval(()=>{void this.refresh(healthFile,child);},2000);
  }
  private async refresh(file:string,child:ChildProcess) {
    try {
      const url=readFileSync(file,'utf8').trim();
      if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) return;
      const response=await fetch(url+'/readyz',{signal:AbortSignal.timeout(1500)});
      if(this.child!==child) return;
      this.healthURL=url;this.status=response.ok?'connected':'connecting';
      this.error=response.ok?null:'Tunnel is running but not ready. Open diagnostics for details.';
    } catch { if(this.child===child) this.status='connecting'; }
  }
  async stop() {
    clearInterval(this.timer);this.timer=undefined;
    const child=this.child;this.child=undefined;
    if(child && child.exitCode===null) {
      await new Promise<void>(resolve=>{
        const timeout=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);
        child.once('exit',()=>{clearTimeout(timeout);resolve();});child.kill('SIGTERM');
      });
    }
    this.status='disconnected';this.healthURL=null;this.error=null;
  }
}
