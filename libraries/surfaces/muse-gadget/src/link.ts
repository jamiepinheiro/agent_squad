import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {NoiseHandshake,NoiseFrames,field,bytes,number} from './noise.js';
export const replySpec={description:'Return the complete final answer to an Agent Squad task. Call only when finished.',required:{task_id:{type:'string',description:'Exact task ID from the prompt'},text:{type:'string',description:'Complete final answer'}},optional:{status:{type:'string',description:'completed or failed'}}};
export class MuseLink {
  connected=false;private ws?:WebSocket;private frames?:NoiseFrames;private stream=1;private control=Buffer.alloc(0);private register=randomUUID();
  private requests=new Map<number,{status:number;size:number;resolve:()=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();private ping?:NodeJS.Timeout;
  constructor(private node:string,private invoke:(command:string,params:any)=>unknown,private ended:(unpaired:boolean)=>void){}
  connect(host:string,vm:string,token:string):Promise<void>{
    return new Promise((resolve,reject)=>{
      const handshake=new NoiseHandshake();let upgraded=false,registered=false,closed=false,alive=true;
      const ws=this.ws=new WebSocket(`wss://${host}/v1/noise?vm_id=${encodeURIComponent(vm)}`,{headers:{Authorization:'Bearer '+token,'User-Agent':'AgentSquad/0.1.5 macOS'},handshakeTimeout:20000,maxPayload:4*1024*1024});
      const timer=setTimeout(()=>{reject(Error('Muse connection timed out'));ws.terminate();},30000);
      const finish=(unpaired=false)=>{if(closed)return;closed=true;clearTimeout(timer);if(this.ping)clearInterval(this.ping);this.connected=false;for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(Error('Muse disconnected; check its side chat before retrying.'));}this.requests.clear();if(!registered)reject(Error('Could not register this Mac with Muse.'));this.ended(unpaired);};
      ws.on('open',()=>{ws.send(handshake.first());this.ping=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},20000);});ws.on('pong',()=>{alive=true;});
      ws.on('error',()=>{reject(Error('Muse connection failed'));});ws.on('close',()=>finish());
      ws.on('message',(raw,binary)=>{try{
        if(!binary)throw Error('Invalid Muse response');const data=Buffer.from(raw as Buffer);
        if(!upgraded){const c=handshake.finish(data);ws.send(c.final);this.frames=new NoiseFrames(c.send,c.receive);upgraded=true;this.sendFrames(1,2,Buffer.concat([field(1,'POST'),field(2,'/link-control')]));this.sendControl({type:'req',id:this.register,method:'link.register',params:{node_id:this.node,display_name:'Agent Squad on Mac',platform:'macos',version:'0.1.5',device_family:'homehub',model_id:'macos',is_wakeup_supported:false,commands_v2:{'agent_squad.reply':replySpec}}});return;}
        const frame=this.frames!.decode(data);if(!frame)return;
        if(frame.stream!==1){const r=this.requests.get(frame.stream);if(!r)return;if(frame.kind===5){clearTimeout(r.timer);this.requests.delete(frame.stream);r.reject(Error('Muse rejected delivery; check its side chat.'));return;}if(frame.kind===3)r.status=number(frame.body,1);r.size+=bytes(frame.body,frame.kind===3?3:1).length;if(r.size>1024*1024)throw Error('Muse response too large');if(number(frame.body,frame.kind===3?4:2)){clearTimeout(r.timer);this.requests.delete(frame.stream);if(r.status>=200&&r.status<300)r.resolve();else r.reject(Error('Muse did not acknowledge delivery; check its side chat.'));}return;}
        if(frame.kind===5||(frame.kind===3&&number(frame.body,1)>=400))throw Error('Muse control stream refused');
        this.control=Buffer.concat([this.control,bytes(frame.body,frame.kind===3?3:1)]);
        while(this.control.length>=4){const len=this.control.readUInt32LE();if(len>4*1024*1024)throw Error('Muse message too large');if(this.control.length<len+4)break;const body=this.control.subarray(4,4+len);this.control=this.control.subarray(4+len);if(!len)continue;const m=JSON.parse(body.toString());
          if(m.id===this.register&&!m.method){if(m.error)throw Error('Muse registration rejected');this.connected=true;registered=true;clearTimeout(timer);resolve();}
          if(['link.unpaired','node.unpaired'].includes(m.event)){finish(true);ws.close();return;}
          if(m.method==='link.invoke'&&typeof m.id==='string')this.sendControl({method:'link.result',id:m.id,...this.invoke(m.command,m.params??{}) as object});
        }
        if(this.control.length>4*1024*1024)throw Error('Muse message too large');if(number(frame.body,frame.kind===3?4:2))ws.close();
      }catch{reject(Error('Invalid or rejected Muse connection'));ws.terminate();}});
    });
  }
  private sendFrames(stream:number,kind:number,body:Buffer){if(!this.frames||this.ws?.readyState!==WebSocket.OPEN)throw Error('Muse is disconnected');for(const frame of this.frames.encode(stream,kind,body))this.ws.send(frame);}
  private sendControl(message:unknown){const data=Buffer.from(JSON.stringify(message)),length=Buffer.alloc(4);length.writeUInt32LE(data.length);this.sendFrames(1,4,field(1,Buffer.concat([length,data])));}
  send(text:string,session:string){if(!this.connected)return Promise.reject(Error('Muse is disconnected'));const id=++this.stream;return new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(id);reject(Error('Muse delivery timed out; check its side chat before retrying.'));},60000);this.requests.set(id,{status:0,size:0,resolve,reject,timer});try{const headers=[['Content-Type','application/json'],['x-request-id',randomUUID()],['x-app-id','musegadget']].map(([k,v])=>field(3,Buffer.concat([field(1,k!),field(2,v!)])));this.sendFrames(id,2,Buffer.concat([field(1,'POST'),field(2,'/chat/stream'),...headers,field(4,JSON.stringify({message:text,device_id:this.node,session_id:session})),field(5,1)]));}catch(e){clearTimeout(timer);this.requests.delete(id);reject(e);}});}
  close(){this.ws?.terminate();if(this.ping)clearInterval(this.ping);this.connected=false;}
}
