import { PROFILE_PHOTO_PROMPT, photoCandidates, loadPhoto } from './profile-photo.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from './store.js';
import { fail, messageOf, type Agent, type Session } from './types.js';
import { SurfaceRegistry, type TurnUpdate } from './surface.js';

export class Router {
  private turns=new Map<string,AbortController>();
  private jobs=new Map<string,Promise<void>>();
  constructor(readonly store:Store,readonly surfaces:SurfaceRegistry,private pollMilliseconds=1000) {
    store.state.agents=store.state.agents.map(agent=>surfaces.find(agent.adapterType)?.validate(agent) ?? agent);
    for(const session of store.state.sessions) {
      const agent=store.state.agents.find(a=>a.id===session.agentId);
      if(agent) surfaces.find(agent.adapterType)?.normalizeSession?.(session);
    }
    store.save();
  }
  agents() { return this.store.state.agents; }
  agent(id:string) { return this.agents().find(a=>a.id===id) ?? fail('Agent not found.'); }
  saveAgent(input:unknown) {
    const agent=this.surfaces.parse(input);
    if(this.store.state.sessions.some(s=>s.agentId===agent.id && this.turns.has(s.id))) fail('Wait for this agent’s active turn before editing it.');
    const surface=this.surfaces.get(agent.adapterType);
    const addresses=(a:Agent)=>surface.conversationKeys(a);
    if(this.agents().some(a=>a.id!==agent.id && a.adapterType===agent.adapterType && addresses(a).some(x=>addresses(agent).includes(x)))) fail('This conversation is already registered.');
    const index=this.agents().findIndex(a=>a.id===agent.id);
    if(index<0) this.agents().push(agent); else this.agents()[index]=agent;
    this.store.save(); return agent;
  }
  async requestProfilePhoto(agentId:string, force=false) {
    const agent=this.agent(agentId);
    if(this.surfaces.get(agent.adapterType).profilePhotoSource==='local' || (agent.profilePhoto && !force)) return;
    if(!agent.enabled) fail('Enable this agent before requesting an image.');
    if(agent.profilePhotoStatus==='loading' || this.list(agentId).some(s=>this.turns.has(s.id))) fail('Wait for this agent’s current task before refreshing its image.');
    agent.profilePhotoStatus='loading';this.store.save();
    try {
      const session=this.create(agentId);
      this.send(agentId,session.id,PROFILE_PHOTO_PROMPT);
      await this.jobs.get(session.id);
      if(session.status!=='completed') return;
      for(const candidate of [...new Set([...photoCandidates(session),...(this.surfaces.get(agent.adapterType).photoCandidates?.(session) ?? [])])].slice(0,5)) {
        const photo=await loadPhoto(candidate,AbortSignal.timeout(10000)).catch(()=>undefined);
        const current=this.agents().find(a=>a.id===agentId);
        if(!current || current.endpoint!==agent.endpoint || current.recipient!==agent.recipient || current.adapterType!==agent.adapterType) return;
        if(photo) {current.profilePhoto=photo;current.profilePhotoStatus='ready';this.store.save();return;}
      }
    } finally {
      const current=this.agents().find(a=>a.id===agentId);
      if(current?.profilePhotoStatus==='loading') {current.profilePhotoStatus='unavailable';this.store.save();}
    }
  }
  deleteAgent(id:string) {
    this.agent(id);
    if(this.store.state.sessions.some(s=>s.agentId===id && this.turns.has(s.id))) fail('Cancel active turns before removing this agent.');
    this.store.state.agents=this.agents().filter(a=>a.id!==id);
    this.store.state.sessions=this.store.state.sessions.filter(s=>s.agentId!==id); this.store.save();
  }
  create(agentId:string) {
    const agent=this.agent(agentId); this.surfaces.get(agent.adapterType); if(!agent.enabled) fail('This agent is paused.');
    const now=new Date().toISOString();
    const session:Session={id:randomUUID(),agentId,contextId:randomUUID(),status:'idle',createdAt:now,updatedAt:now,messages:[]};
    this.store.state.sessions.push(session); this.store.save(); return session;
  }
  get(agentId:string,id:string) { this.agent(agentId); return this.store.state.sessions.find(s=>s.id===id && s.agentId===agentId) ?? fail('Session not found for this agent.'); }
  list(agentId?:string) { if(agentId) this.agent(agentId); return this.store.state.sessions.filter(s=>!agentId || s.agentId===agentId); }
  send(agentId:string,id:string,text:string,messageId:string=randomUUID()) {
    const agent=this.agent(agentId); const session=this.get(agentId,id);
    if(!agent.enabled) fail('This agent is paused.');
    if(!text.trim() || text.length>50000) fail('Prompt must contain 1–50,000 characters.');
    if(this.turns.has(id)) fail('This session already has an active turn.');
    // Messaging transports have one shared conversation, even across protocol sessions.
    if(this.surfaces.get(agent.adapterType).kind==='messaging' && this.list(agentId).some(s=>this.turns.has(s.id))) fail('This messaging conversation is busy. Wait for its current turn.');
    const controller=new AbortController(); this.turns.set(id,controller);
    const previousStatus=session.status;
    session.messages.push({id:messageId,role:'user',text,timestamp:new Date().toISOString()});
    session.status='working'; delete session.error; this.touch(session);
    const job=this.run(agent,session,text,previousStatus,controller).catch(error=>{
      if(session.status!=='canceled' && session.status!=='interrupted') {session.status='failed';session.error=(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name)) ? `No complete response within ${agent.timeoutSeconds} seconds. The remote agent may still be working; check before retrying.` : messageOf(error);}
      this.touch(session);
    }).finally(()=>{ this.turns.delete(id); this.jobs.delete(id); });
    this.jobs.set(id,job);
    return session;
  }
  private async run(agent:Agent,session:Session,text:string,previousStatus:Session['status'],controller:AbortController) {
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(agent.timeoutSeconds*1000)]);
    const surface=this.surfaces.get(agent.adapterType);
    if(surface.kind==='task') {
      const input={...session,status:previousStatus};
      if(previousStatus!=='input-required') delete session.remoteTaskId;
      const result=await surface.tasks.send(agent,input,text,signal);
      if(result.remoteTaskId) session.remoteTaskId=result.remoteTaskId;
      if(controller.signal.aborted) {
        if(session.remoteTaskId) await surface.tasks.cancel(agent,session.remoteTaskId).catch(()=>{});
        return;
      }
      this.applyUpdate(session,result);
      while(session.status==='working') {
        if(!session.remoteTaskId) fail('The surface returned a working task without a remote task ID.');
        await delay(this.pollMilliseconds,undefined,{signal});
        const update=await surface.tasks.get(agent,session.remoteTaskId!,signal);
        signal.throwIfAborted(); this.applyUpdate(session,update);
      }
      return;
    }
    const transport=surface.transport;
    let cursor=await transport.baseline(agent,signal);
    signal.throwIfAborted();
    await transport.send(agent,text,signal);
    let lastReceived:number|undefined;
    while(true) {
      await delay(this.pollMilliseconds,undefined,{signal});
      const batch=await transport.receive(agent,cursor,signal); signal.throwIfAborted(); cursor=batch.cursor;
      for(const message of batch.messages) {
        if(session.messages.some(m=>m.id===message.id)) continue;
        session.messages.push({...message,role:'agent'}); lastReceived=Date.now();
      }
      if(batch.messages.length) this.touch(session);
      if(lastReceived!==undefined && Date.now()-lastReceived>=agent.quietSeconds*1000) {session.status='completed';this.touch(session);return;}
    }
  }
  private applyUpdate(session:Session,result:TurnUpdate) {
    session.remoteResult=result.raw;
    if(result.contextId) session.contextId=result.contextId;
    if(result.remoteTaskId) session.remoteTaskId=result.remoteTaskId;
    session.status=result.status;
    session.error=result.error;
    for(const message of result.messages ?? []) {
      const existing=session.messages.find(m=>m.id===message.id);
      if(existing) Object.assign(existing,message);else session.messages.push(message);
    }
    this.surfaces.get(this.agent(session.agentId).adapterType).normalizeSession?.(session);
    this.touch(session);
  }
  async cancel(agentId:string,id:string) {
    const session=this.get(agentId,id); const agent=this.agent(agentId);
    if(!this.turns.has(id) && !['input-required','interrupted'].includes(session.status)) return session;
    const surface=this.surfaces.get(agent.adapterType);
    if(surface.kind==='task' && session.remoteTaskId) {
      const result=await surface.tasks.cancel(agent,session.remoteTaskId);
      if(result.status!=='canceled') fail('The remote agent did not confirm cancellation.');
    }
    session.status='canceled'; session.error=surface.kind==='task' ? (session.remoteTaskId ? undefined : 'Stopped waiting before a remote task ID was available. The remote agent may still be working.') : 'Stopped waiting. The message was already sent; the remote agent may continue working.';
    this.turns.get(id)?.abort(); this.touch(session); return session;
  }
  resume(agentId:string,id:string) { return this.get(agentId,id); }
  private touch(session:Session) { session.updatedAt=new Date().toISOString();this.store.save(); }
  async shutdown() {
    for(const [id,controller] of this.turns) {
      const session=this.store.state.sessions.find(s=>s.id===id)!;
      session.status='interrupted';session.error='Agent Squad stopped during this turn. Check the conversation before retrying.';
      controller.abort();
    }
    this.store.save(); await Promise.allSettled([...this.jobs.values()]);
  }
}
