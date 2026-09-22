import { spawn } from 'node:child_process';
import { mkdtempSync,openSync,closeSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, MessagingTransport, Incoming } from '@agent-squad/kernel';

export class IMessageTransport implements MessagingTransport {
  constructor(private helper:string,private helperTimeout=20000) {}
  private async invoke(args:string[], input?:string,signal?:AbortSignal) {
    if(!this.helper) throw Error('iMessage requires the Agent Squad macOS app.');
    // Apple Events can leave descendants holding inherited pipes. Wait for the
    // helper's exit, with file-backed output, rather than waiting for pipe EOF.
    const directory=mkdtempSync(join(tmpdir(),'agent-squad-messages-'));
    const out=join(directory,'out'),err=join(directory,'err');
    const stdout=openSync(out,'w',0o600),stderr=openSync(err,'w',0o600);
    try {
      await new Promise<void>((resolve,reject)=>{
        signal?.throwIfAborted();
        const child=spawn(this.helper,args,{stdio:['pipe',stdout,stderr],signal,killSignal:'SIGKILL'});
        let settled=false;
        const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Messages helper timed out. The message may already have been sent; check the conversation before retrying.'));},this.helperTimeout);
        const finish=(error?:Error)=>{if(settled) return;settled=true;clearTimeout(timer);if(error) reject(error);else resolve();};
        child.once('error',finish);
        child.once('exit',(code)=>{if(!settled) finish(code===0?undefined:Error(readFileSync(err,'utf8').trim() || 'Could not access Messages. Check Agent Squad’s Messages permissions.'));});
        child.stdin?.on('error',()=>{});child.stdin?.end(input ?? '');
      });
      return JSON.parse(readFileSync(out,'utf8'));
    } finally {closeSync(stdout);closeSync(stderr);rmSync(directory,{recursive:true,force:true});}
  }
  async baseline(_agent:Agent,signal?:AbortSignal):Promise<string> { return String((await this.invoke(['--messages-baseline'],undefined,signal)).cursor); }
  async send(agent:Agent,text:string,signal?:AbortSignal):Promise<void> { await this.invoke(['--messages-send',agent.recipient],text,signal); }
  async receive(agent:Agent,after:string,signal?:AbortSignal):Promise<{cursor:string;messages:Incoming[]}> { return await this.invoke(['--messages-read',agent.recipient,after],JSON.stringify(agent.recipientAliases),signal); }
  async businessChats():Promise<{guid:string;recipient:string;name:string}[]> { return (await this.invoke(['--messages-business-chats'])).chats; }
  async health():Promise<string> { await this.baseline({} as Agent); return 'Messages database is readable. Configure Messages control in Settings → Connectors → Set Up iMessage.'; }
}
