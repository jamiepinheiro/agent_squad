import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {SecretReader,TurnUpdate,Agent} from '@agent-squad/kernel';
import {type Identity} from './pairing.js';
import {MuseLink} from './link.js';
import {parsePairingExport} from './import.js';
const account='muse-gadget.native';
type Saved={device:Identity;sdkToken:string;credentials?:{access_token:string;refresh_token:string;api_url_v2:string;noise_host:string;updated:number}};
type Task={id:string;sessionId:string;status:'working'|'completed'|'failed'|'canceled';text?:string;error?:string;deadline:number};
export async function saveNative(value:Saved){const helper=process.env.AGENT_SQUAD_HELPER;if(!helper)throw Error('Native Muse pairing requires the Mac app.');await new Promise<void>((resolve,reject)=>{const p=spawn(helper,['--muse-credential-write'],{stdio:['pipe','ignore','ignore']});const timer=setTimeout(()=>{p.kill();reject(Error('Keychain save timed out'));},30000);p.on('error',()=>{clearTimeout(timer);reject(Error('Could not save Muse credentials'));});p.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Could not save Muse credentials'));});p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(value));});}
export class NativeMuse {
  private saved?:Saved;private link?:MuseLink;private reconnect?:NodeJS.Timeout;private stopped=false;private connecting=false;
  private importing=false;
  private refreshTimer?:NodeJS.Timeout;
  private tasks=new Map<string,Task>();private status='Not paired';
  constructor(private secret:SecretReader,private save:typeof saveNative=saveNative){}
  state(){return {paired:!!this.saved?.credentials,connected:this.link?.connected===true,name:this.saved?.device.name??'',status:this.status};}
  async start(){this.stopped=false;this.refreshTimer=setInterval(()=>{if(!this.importing&&this.saved?.credentials&&Date.now()-this.saved.credentials.updated>3*3600000)void this.refresh(this.saved).catch(()=>{this.status='Could not refresh Muse authorization; retrying.';});},60000);const value=await this.secret(account);if(value){try{this.saved=JSON.parse(value);}catch{this.status='Saved pairing is invalid. Pair again.';return;}void this.connect();}}
  stop(){this.stopped=true;clearInterval(this.refreshTimer);clearTimeout(this.reconnect);this.link?.close();}
  async importPairing(input:unknown){
    const candidate=parsePairingExport(input);
    if(this.active())throw Error('Finish the current Muse task before importing a pairing.');
    if(this.importing||this.connecting)throw Error('Muse is connecting. Wait for it to finish before importing.');
    if(this.saved?.credentials&&this.saved.device.node_id===candidate.device.node_id)
      throw Error('This device is already imported. Agent Squad manages its current credentials; do not import an older copy.');
    this.importing=true;
    const previousStatus=this.status;
    let probe:MuseLink|undefined;
    try {
      if(this.refreshing)await this.refreshing.catch(()=>{});
      this.status='Checking imported pairing…';
      let data;
      try { data=await this.api('/fetch_vms',candidate.credentials); }
      catch(error){
        if((error as any)?.status!==401)throw error;
        const raw=await this.api('/device_token/refresh',candidate.credentials,{device_id:candidate.device.node_id,sdk_token:candidate.sdkToken});
        const tokens=raw.payload??raw;
        candidate.credentials.access_token=tokens.access_token;
        candidate.credentials.refresh_token=tokens.refresh_token;
        // Revalidate refreshed values before they reach headers or Keychain.
        parsePairingExport({format:'agent-squad-muse-pairing',version:1,identity:{mac:candidate.device.mac},sdk_token:candidate.sdkToken,pairing:candidate.credentials});
        data=await this.api('/fetch_vms',candidate.credentials);
      }
      const list=Array.isArray(data.vm_list)?data.vm_list:[];
      const vm=list.find((v:any)=>v.default)||list[0];
      const vmID=vm?.vm_id||vm?.vm_name;
      if(typeof vmID!=='string'||!vmID||typeof vm?.vm_auth_token!=='string')throw Error('Muse has no available instance for this pairing.');
      // Verify registration without sending any user message, before replacing Keychain state.
      probe=new MuseLink(candidate.device.node_id,()=>({ok:false,error:'Pairing import is being verified'}),()=>{});
      await probe.connect(candidate.credentials.noise_host,vmID,vm.vm_auth_token);
      if(this.stopped||!probe.connected)throw Error('Muse disconnected during import.');
      await this.save(candidate);

      clearTimeout(this.reconnect);
      const old=this.link;this.link=undefined;old?.close();
      this.saved=candidate;
      this.status='Pairing imported. Connecting…';
    } catch(error){
      this.status=previousStatus;
      throw Error('Could not import Muse pairing. Check that the Pi service is stopped and the export is current. '+(error instanceof Error?error.message:'Connection failed.'));
    } finally {probe?.close();this.importing=false;if(this.saved?.credentials&&!this.link?.connected&&!this.stopped)this.reconnect=setTimeout(()=>void this.connect(),1000);}
    void this.connect();
    return this.state();
  }
  private async api(path:string,credentials:NonNullable<Saved['credentials']>,body?:unknown){const root=credentials.api_url_v2||'https://api.muse.ai';if(new URL(root).origin!=='https://api.muse.ai')throw Error('Unexpected Muse API host');const response=await fetch(root.replace(/\/$/,'')+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+(body?'hatch_refresh:'+credentials.refresh_token.split(':').pop():credentials.access_token),'X-API-Version':'1.0.0','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Object.assign(Error(`Muse authorization failed (HTTP ${response.status}). Pair again if it persists.`),{status:response.status});const reader=response.body?.getReader();if(!reader)throw Error('Empty Muse response');let size=0;const chunks:Uint8Array[]=[];try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw Error('Muse response too large');chunks.push(value);}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  private refreshing?:Promise<NonNullable<Saved['credentials']>>;
  private refresh(saved:Saved){
    if(this.refreshing)return this.refreshing;
    const operation=(async()=>{const c=saved.credentials!;const raw=await this.api('/device_token/refresh',c,{device_id:saved.device.node_id,sdk_token:saved.sdkToken});const tokens=raw.payload??raw;if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string')throw Error('Invalid refreshed credentials');const next={...c,access_token:tokens.access_token,refresh_token:tokens.refresh_token,updated:Date.now()};if(this.saved!==saved||this.stopped)throw Error('Pairing changed');await this.save({...saved,credentials:next});if(this.saved!==saved||this.stopped)throw Error('Pairing changed');saved.credentials=next;return next;})();
    this.refreshing=operation;void operation.finally(()=>{this.refreshing=undefined;}).catch(()=>{});return operation;
  }
  private async connect(){if(this.stopped||this.importing||this.connecting||!this.saved?.credentials)return;this.connecting=true;clearTimeout(this.reconnect);const saved=this.saved;try{let c=saved.credentials!;if(Date.now()-c.updated>3*3600000)c=await this.refresh(saved);
      let data;try{data=await this.api('/fetch_vms',c);}catch(error){if((error as any)?.status!==401)throw error;c=await this.refresh(saved);data=await this.api('/fetch_vms',c);}if(this.saved!==saved||this.stopped)return;const list=data.vm_list??[];const vm=list.find((v:any)=>v.default)||list[0];if(!vm?.vm_auth_token)throw Error('Muse has no available instance');const vmId=vm.vm_id||vm.vm_name;if(typeof vmId!=='string'||!vmId)throw Error('Muse instance has no identifier');this.status='Connecting to Muse…';const link=new MuseLink(saved.device.node_id,(command,params)=>this.reply(command,params),unpaired=>{if(this.link!==link)return;this.status=unpaired?'Muse removed this Mac. Pair again.':'Disconnected; reconnecting…';if(unpaired){saved.credentials=undefined;void this.save(saved).catch(()=>{});}for(const t of this.tasks.values())if(t.status==='working'){t.status='failed';t.error='Muse disconnected; check its side chat before retrying.';}if(!this.stopped&&!unpaired)this.reconnect=setTimeout(()=>void this.connect(),10000);});this.link=link;await link.connect(c.noise_host,vmId,vm.vm_auth_token);if(this.saved!==saved||this.stopped){if(this.link===link)this.link=undefined;link.close();return;}this.status='Connected';}catch(e){this.status=e instanceof Error?e.message:'Could not connect to Muse';if(!this.stopped)this.reconnect=setTimeout(()=>void this.connect(),15000);}finally{this.connecting=false;}}
  private active(){this.expire();return [...this.tasks.values()].some(t=>t.status==='working');}
  private expire(){for(const t of this.tasks.values())if(t.status==='working'&&Date.now()>t.deadline){t.status='failed';t.error='No final reply arrived. Muse may still be working; check its side chat before retrying.';}}
  async send(agent:Agent,session:string,text:string,signal:AbortSignal):Promise<TurnUpdate>{signal.throwIfAborted();if(this.importing)throw Error('Wait for the pairing import to finish.');this.expire();if(!this.link?.connected)throw Error('Pair and connect this Mac with Muse first.');if([...this.tasks.values()].some(t=>t.sessionId===session&&t.status==='working'))throw Error('Muse already has an active task in this chat');if([...this.tasks.values()].filter(t=>t.status==='working').length>=32)throw Error('Too many Muse tasks');while(this.tasks.size>=200){const old=[...this.tasks].find(([,t])=>t.status!=='working');if(!old)throw Error('Too many tasks');this.tasks.delete(old[0]);}const id=randomUUID();const t:Task={id,sessionId:session,status:'working',deadline:Date.now()+agent.timeoutSeconds*1000};this.tasks.set(id,t);const prompt=`Agent Squad task ${id}. Complete this user request: ${JSON.stringify(text)}\nWhen finished, invoke this device's agent_squad.reply command with task_id=${id} and text containing your complete final answer. Use status=failed if unsuccessful. A normal chat reply does not return an answer to Agent Squad.`;void this.link.send(prompt,session).catch(()=>{if(t.status==='working'){t.status='failed';t.error='Delivery could not be confirmed. Check Muse before retrying; no message was resent.';}});return this.get(id);}
  get(id:string):TurnUpdate{this.expire();const t=this.tasks.get(id);if(!t)throw Error('Task not found; the app may have restarted. Check Muse before retrying.');return {status:t.status,remoteTaskId:t.id,contextId:t.sessionId,error:t.error,messages:t.status==='completed'?[{id:'muse-gadget:'+t.id,role:'agent',text:t.text!,timestamp:new Date().toISOString()}]:[]};}
  cancel(id:string){this.get(id);const t=this.tasks.get(id)!;if(t.status==='working'){t.status='canceled';t.error='Stopped waiting. Muse may continue working.';}return this.get(id);}
  private reply(command:string,params:any){this.expire();if(command!=='agent_squad.reply')return {ok:false,error:'Unsupported command'};const t=this.tasks.get(params?.task_id),status=params?.status??'completed';if(!t||typeof params.text!=='string'||!params.text.trim()||params.text.length>50000||!['completed','failed'].includes(status))return {ok:false,error:'Invalid reply'};if(t.status!=='working')return {ok:t.status===status&&(t.text??t.error)===params.text};t.status=status;if(status==='completed')t.text=params.text;else t.error=params.text;return {ok:true,payload:{accepted:true}};}
}
