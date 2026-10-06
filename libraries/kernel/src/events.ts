import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Router } from './router.js';
import type { TaskSurface, TurnUpdate } from './surface.js';
import { fail, type Agent, type Session } from './types.js';
import { callbackURL, EventError, signedHeaders, signingKey, webhookPost, type WebhookPost } from './webhook.js';

const eventName='agent_squad.task.assigned';
const agentId=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const filters=z.object({agent_id:agentId}).strict();
const subscriptionInput=z.object({name:z.literal(eventName),arguments:filters,delivery:z.object({mode:z.literal('webhook'),url:z.string().max(2000),secret:z.string().max(100)}).strict(),cursor:z.null().optional(),ttlMs:z.number().int().positive().optional(),_meta:z.unknown().optional()}).strict();
const unsubscribeInput=subscriptionInput.omit({cursor:true,ttlMs:true}).extend({delivery:subscriptionInput.shape.delivery.omit({secret:true})});
interface Subscription {id:string;agentId:string;url:string;secret:string;expires:number;verifiedUntil:number;error?:string}
interface Assignment {id:string;agentId:string;sessionId:string;contextId:string;prompt:string;timestamp:string;deadline:number;status:'working'|'completed'|'failed'|'input-required'|'canceled';text?:string;deliveries:Record<string,{attempts:number;next:number;done:boolean}>}
interface EventState {version:1;subscriptions:Subscription[];assignments:Assignment[]}
export const registrationSchema={registration_id:agentId.describe('Stable chosen ID. Reuse this ID when reconnecting.'),name:z.string().trim().min(1).max(100)};
export const resultSchema={agent_id:agentId,task_id:z.string(),status:z.enum(['completed','failed','input-required']),text:z.string().trim().min(1).max(50000)};
export const eventDefinition={name:eventName,description:'A new task assigned to a registered Agent Squad agent. Read the task with get_assigned_task before acting and return the result with complete_assigned_task.',delivery:['webhook'],inputSchema:{type:'object',properties:{agent_id:{type:'string',description:'The agent_id returned by register_event_agent.'}},required:['agent_id'],additionalProperties:false},payloadSchema:{type:'object',properties:{agent_id:{type:'string'},task_id:{type:'string'},session_id:{type:'string'}},required:['agent_id','task_id','session_id'],additionalProperties:false}};

export class EventAgents {
  private state:EventState;
  private router!:Router;
  private timer?:ReturnType<typeof setInterval>;
  private flushing?:Promise<void>;
  private closed=false;
  private file:string;
  constructor(directory:string,private post:WebhookPost=webhookPost) {
    this.file=join(directory,'mcp-events.json');
    this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{version:1,subscriptions:[],assignments:[]};
    if(this.state.version!==1 || !Array.isArray(this.state.subscriptions) || !Array.isArray(this.state.assignments)) throw Error('Invalid MCP Events state.');
  }
  bind(router:Router) {this.router=router;}
  private save() {writeFileSync(this.file+'.tmp',JSON.stringify(this.state),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  private agent(id:string) {
    const agent=this.router.agent(id);
    if(agent.adapterType!=='mcp-events' || !agent.enabled) fail('MCP Events agent is missing or paused.');
    return agent;
  }
  register(input:unknown) {
    const {registration_id,name}=z.object(registrationSchema).strict().parse(input);
    const id=`events-${createHash('sha256').update(registration_id).digest('hex').slice(0,32)}`;
    const existing=this.router.agents().find(a=>a.id===id);
    if(existing && existing.adapterType!=='mcp-events') fail('Registration ID is already in use.');
    const agent=existing ?? this.router.saveAgent({id,name,adapterType:'mcp-events',timeoutSeconds:3600,connection:{registrationID:registration_id}});
    return {agent_id:agent.id,event:eventName,arguments:{agent_id:agent.id},registered:true,subscribed:this.active(agent.id).length>0,instructions:'Subscribe to the event using the returned arguments in your client. Fetch pending tasks with list_assigned_tasks after subscribing or reconnecting. Read each task before acting. Complete it with complete_assigned_task. Keep the subscription refreshed until the user stops it.'};
  }
  private active(agentId:string) {return this.state.subscriptions.filter(s=>s.agentId===agentId && s.expires>Date.now());}
  async rpc(method:string,input:unknown={}) {
    if(method==='events/list') return {events:[eventDefinition]};
    if(method==='events/unsubscribe') {
      const p=unsubscribeInput.parse(input),id=this.subscriptionId(p.arguments.agent_id,p.delivery.url);
      this.state.subscriptions=this.state.subscriptions.filter(s=>s.id!==id);this.save();return {};
    }
    if(method!=='events/subscribe') throw new EventError('Unknown event method.',-32601);
    const p=subscriptionInput.parse(input);this.agent(p.arguments.agent_id);callbackURL(p.delivery.url);signingKey(p.delivery.secret);
    const id=this.subscriptionId(p.arguments.agent_id,p.delivery.url);
    const existing=this.state.subscriptions.find(s=>s.id===id);
    const subscription:Subscription={id,agentId:p.arguments.agent_id,url:p.delivery.url,secret:p.delivery.secret,expires:Date.now()+Math.min(p.ttlMs ?? 86400000,86400000),verifiedUntil:existing?.verifiedUntil ?? 0};
    if(!existing || existing.verifiedUntil<Date.now() || existing.secret!==subscription.secret) {
      const challenge=randomUUID(),body=JSON.stringify({type:'verification',challenge});
      try {
        const response=await this.post(subscription.url,body,signedHeaders(subscription.secret,randomUUID(),body,id));
        const echoed=JSON.parse(response.body)?.challenge;
        if(response.status<200 || response.status>=300 || typeof echoed!=='string' || Buffer.byteLength(echoed)!==Buffer.byteLength(challenge) || !timingSafeEqual(Buffer.from(echoed),Buffer.from(challenge))) throw Error('Challenge mismatch.');
        subscription.verifiedUntil=Date.now()+300000;
      } catch(error) {
        if(error instanceof EventError) throw error;
        throw new EventError('Callback verification failed.',-32015,{reason:'challenge_failed'});
      }
    }
    this.agent(subscription.agentId);
    if(this.closed) throw new EventError('Agent Squad is stopping.',-32015,{reason:'unavailable'});
    this.state.subscriptions=this.state.subscriptions.filter(s=>s.id!==id);this.state.subscriptions.push(subscription);this.save();
    return {id,refreshBefore:new Date(subscription.expires).toISOString(),cursor:null,truncated:false};
  }
  private subscriptionId(agentId:string,url:string) {
    // The trusted tunnel/network grants access to one local workspace principal.
    return `sub_${createHash('sha256').update(JSON.stringify(['local-workspace',url,eventName,{agent_id:agentId}])).digest('hex')}`;
  }
  remove(agentId:string) {
    this.state.subscriptions=this.state.subscriptions.filter(s=>s.agentId!==agentId);
    this.state.assignments=this.state.assignments.filter(t=>t.agentId!==agentId);
    this.save();
  }
  private assignment(agentId:string,id:string) {
    this.agent(agentId);
    const task=this.state.assignments.find(t=>t.id===id && t.agentId===agentId) ?? fail('Task not found for this agent.');
    this.reconcile(task);return task;
  }
  private reconcile(task:Assignment) {
    if(task.status!=='working') return;
    const session=this.router.list().find(s=>s.id===task.sessionId && s.agentId===task.agentId);
    if(!session || ['canceled','failed','completed','input-required'].includes(session.status) || task.deadline<=Date.now()) {task.status='canceled';this.save();}
  }
  read(agentId:string,id:string) {
    const task=this.assignment(agentId,id);
    const session=this.router.get(agentId,task.sessionId);
    return {task_id:task.id,agent_id:agentId,session_id:task.sessionId,context_id:task.contextId,status:task.status,prompt:task.prompt,messages:session.messages,deadline:new Date(task.deadline).toISOString(),...(task.text?{result:task.text}:{})};
  }
  pending(agentId:string) {
    this.agent(agentId);
    return this.state.assignments.filter(t=>t.agentId===agentId).flatMap(t=>{this.reconcile(t);return t.status==='working'?[{task_id:t.id,session_id:t.sessionId,created_at:t.timestamp}]:[];});
  }
  complete(input:unknown) {
    const p=z.object(resultSchema).strict().parse(input),task=this.assignment(p.agent_id,p.task_id);
    if(task.status!=='working') {
      if(task.status===p.status && task.text===p.text) return {task_id:task.id,status:task.status};
      fail('Task has ended; a different or late result cannot overwrite it.');
    }
    task.status=p.status;task.text=p.text;this.save();return {task_id:task.id,status:task.status};
  }
  private update(task:Assignment):TurnUpdate {
    return {status:task.status,remoteTaskId:task.id,...(task.text?{messages:[{id:`event-result-${task.id}`,role:'agent' as const,text:task.text,timestamp:new Date().toISOString()}]}:{})};
  }
  private enqueue(agent:Agent,session:Session,prompt:string) {
    this.agent(agent.id);
    if(!this.active(agent.id).length) fail('This agent is not listening. Paste its setup prompt into an MCP Events client and subscribe first.');
    const task:Assignment={id:randomUUID(),agentId:agent.id,sessionId:session.id,contextId:session.contextId,prompt,timestamp:new Date().toISOString(),deadline:Date.now()+agent.timeoutSeconds*1000,status:'working',deliveries:{}};
    this.state.assignments.push(task);this.save();return this.update(task);
  }
  surface():TaskSurface {
    return {id:'mcp-events',kind:'task',resumeOnRestart:true,profilePhotoSource:'reply',validate:a=>{
      const registrationID=(a.connection as {registrationID?:string}|undefined)?.registrationID;
      if(!registrationID || a.id!==`events-${createHash('sha256').update(registrationID).digest('hex').slice(0,32)}`) fail('Add this agent through MCP Events registration.');
      return a;
    },conversationKeys:()=>[],
      normalizeSession:session=>{
        const task=[...this.state.assignments].reverse().find(t=>t.sessionId===session.id);
        if(task && session.status==='interrupted' && task.deadline>Date.now()) session.remoteTaskId=task.id;
      },
      tasks:{send:async(a,s,text)=>this.enqueue(a,s,text),get:async(a,id)=>this.update(this.assignment(a.id,id)),cancel:async(a,id)=>{const task=this.assignment(a.id,id);if(task.status==='working' || task.status==='input-required') {task.status='canceled';this.save();}return this.update(task);}},
      appState:()=>({mcpEvents:{agents:this.router?.agents().filter(a=>a.adapterType==='mcp-events').map(a=>({id:a.id,listening:a.enabled && this.active(a.id).length>0,subscriptions:this.active(a.id).length,error:this.active(a.id).find(s=>s.error)?.error ?? null})) ?? []}}),
      start:()=>{this.closed=false;this.timer=setInterval(()=>{void this.flush().catch(()=>{});},1000);this.timer.unref();},
      stop:async()=>{this.closed=true;clearInterval(this.timer);await this.flushing;},
    };
  }
  flush():Promise<void> {
    if(this.flushing) return this.flushing;
    this.flushing=this.deliver().finally(()=>{this.flushing=undefined;});return this.flushing;
  }
  private async deliver() {
    for(const task of this.state.assignments) {
      if(this.closed) return;
      this.reconcile(task);if(task.status!=='working') continue;
      const agent=this.router.agents().find(a=>a.id===task.agentId);
      if(!agent?.enabled || agent.adapterType!=='mcp-events') continue;
      for(const sub of this.active(task.agentId)) {
        this.reconcile(task);
        if(this.closed || task.status!=='working' || !this.state.subscriptions.includes(sub) || !this.router.agents().some(a=>a.id===task.agentId && a.enabled && a.adapterType==='mcp-events')) continue;
        const delivery=task.deliveries[sub.id] ??= {attempts:0,next:0,done:false};
        if(delivery.done || delivery.next>Date.now() || delivery.attempts>=8) continue;
        const body=JSON.stringify({eventId:task.id,name:eventName,timestamp:task.timestamp,data:{agent_id:task.agentId,task_id:task.id,session_id:task.sessionId},cursor:null});
        delivery.attempts++;delivery.next=Date.now()+Math.min(300000,1000*2**delivery.attempts);this.save();
        try {
          const response=await this.post(sub.url,body,signedHeaders(sub.secret,task.id,body,sub.id));
          if(response.status>=200 && response.status<300) {delivery.done=true;delete sub.error;}
          else {
            sub.error=`Webhook returned HTTP ${response.status}.`;
            if(response.status===410) sub.expires=0;
            if(response.status===410 || response.status===413 || (response.status>=400 && response.status<500 && response.status!==429)) delivery.done=true;
          }
        } catch {sub.error='Webhook delivery failed. Check the client subscription.';}
        this.save();
      }
    }
    const before=this.state.subscriptions.length;
    this.state.subscriptions=this.state.subscriptions.filter(s=>s.expires>Date.now());
    if(before!==this.state.subscriptions.length) this.save();
  }
}
