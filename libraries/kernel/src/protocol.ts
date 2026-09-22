import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Router } from './router.js';
import { fail, messageOf, type Session } from './types.js';

export class Protocol {
  constructor(readonly router:Router) {}
  async card(agentId:string,baseURL:string) {
    const agent=this.router.agent(agentId);
    const surface=this.router.surfaces.get(agent.adapterType);
    if(surface.card) return surface.card(agent);
    return {name:agent.name,description:'Messaging connection. Ask the agent directly to describe its skills.',url:`${baseURL}/a2a/${agent.id}`,version:'0.1.0',protocolVersion:'0.3.0',preferredTransport:'JSONRPC',
      capabilities:{streaming:false,pushNotifications:false},defaultInputModes:['text/plain'],defaultOutputModes:['text/plain'],
      skills:[{id:'conversation',name:'Converse with the agent',description:'Send text to the agent, including questions about its skills. Domain skills are described by the agent in its replies.',tags:[agent.adapterType]}]};
  }
  task(session:Session) {
    const state=({idle:'submitted',working:'working',completed:'completed',failed:'failed',canceled:'canceled','input-required':'input-required',interrupted:'failed'} as const)[session.status];
    return {kind:'task',id:session.id,contextId:session.contextId,status:{state,timestamp:session.updatedAt,
      ...(session.error?{message:{kind:'message',messageId:randomUUID(),role:'agent',parts:[{kind:'text',text:session.error}]}}:{})},
      history:session.messages.map(m=>({kind:'message',messageId:m.id,role:m.role,parts:[{kind:'text',text:m.text}],contextId:session.contextId,taskId:session.id}))};
  }
  async a2a(agentId:string,method:string,params:any) {
    const agent=this.router.agent(agentId);
    if(!agent.enabled) fail('This agent is paused.');
    if(!['message/send','tasks/get','tasks/cancel'].includes(method)) fail('Supported operations: message/send, tasks/get, tasks/cancel. Streaming and push notifications are not advertised.');
    const surface=this.router.surfaces.get(agent.adapterType);
    if(surface.rpc) return surface.rpc(agent,method,params);
    if(method==='message/send') {
      const m=params?.message;
      if(m?.role!=='user' || !Array.isArray(m.parts) || !m.parts.length || m.parts.some((p:any)=>p.kind!=='text' || typeof p.text!=='string')) fail('Messaging agents accept user messages with text parts only.');
      if(typeof m.messageId!=='string' || !m.messageId || m.messageId.length>200) fail('A messageId of 1–200 characters is required.');
      const text=m.parts.map((p:any)=>p.text).join('\n');
      if(!text.trim() || text.length>50000) fail('Prompt must contain 1–50,000 characters.');
      const duplicate=this.router.list(agentId).find(s=>s.messages.some(message=>message.role==='user' && message.id===m.messageId));
      if(duplicate) {
        if(duplicate.messages.find(message=>message.id===m.messageId)?.text!==text) fail('This messageId was already used with different text.');
        return this.task(duplicate);
      }
      const existing=m.taskId ? this.router.get(agentId,m.taskId) : undefined;
      if(existing && ['completed','failed','canceled','interrupted'].includes(existing.status)) fail('This task has ended. Send a new message with the same contextId and no taskId.');
      if(!existing && surface.kind==='messaging' && this.router.list(agentId).some(s=>s.status==='working')) fail('This messaging conversation is busy. Wait for its current turn.');
      const session=existing ?? this.router.create(agentId);
      if(!existing && typeof m.contextId==='string' && m.contextId.length<=200) session.contextId=m.contextId;
      this.router.send(agentId,session.id,text,m.messageId);
      return this.task(session);
    }
    if(typeof params?.id!=='string') fail('Task id is required.');
    return this.task(method==='tasks/cancel' ? await this.router.cancel(agentId,params.id) : this.router.get(agentId,params.id));
  }
  mcp(baseURL='http://127.0.0.1:9847') {
    const server=new McpServer({name:'agent-squad',version:'0.1.0'});
    const agent={agent_id:z.string().describe('Registered agent ID from list_agents')};
    const session={...agent,session_id:z.string()};
    const register=(name:string,description:string,inputSchema:any,readOnly:boolean,action:(args:any)=>unknown)=>{
      server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:true}},async(args:any)=>{
        try {const result=await action(args); return {content:[{type:'text' as const,text:JSON.stringify(result)}]};}
        catch(error) {return {isError:true,content:[{type:'text' as const,text:messageOf(error)}]};}
      });
    };
    register('list_agents','List agent identities and connection types. Use get_agent_card for native A2A skills; ask messaging agents about their skills with send_prompt.',{},true,()=>this.router.agents().map(a=>({id:a.id,name:a.name,adapterType:a.adapterType,enabled:a.enabled})));
    register('get_agent_card','Read the native agent’s own A2A Agent Card, including its advertised skills. Messaging agents expose a conversation adapter card; ask them directly using send_prompt to learn their skills. This tool never sends a message.',agent,true,a=>this.card(a.agent_id,baseURL));
    register('create_session','Start a persistent conversation context with an agent.',agent,false,a=>this.router.create(a.agent_id));
    register('send_prompt','Delegate a text task. Returns immediately; poll get_session until the turn finishes. Sends a real message for messaging agents.',{...session,prompt:z.string().min(1).max(50000)},false,a=>this.router.send(a.agent_id,a.session_id,a.prompt));
    register('get_session','Read task status, replies, and errors.',session,true,a=>this.router.get(a.agent_id,a.session_id));
    register('resume_session','Load a saved conversation. Use send_prompt to continue it; this never resends an interrupted message.',session,true,a=>this.router.resume(a.agent_id,a.session_id));
    register('list_sessions','List saved session IDs and status for an agent.',agent,true,a=>this.router.list(a.agent_id).map(({messages,remoteResult,...s})=>s));
    register('cancel','Cancel the active turn. For messaging agents this stops waiting; it cannot recall a sent message or stop the remote agent.',session,false,a=>this.router.cancel(a.agent_id,a.session_id));
    register('send_message','A2A 0.3 message/send. Native agents are proxied; messaging agents accept text parts. Poll get_task for completion.',{...agent,params:z.object({message:z.object({kind:z.literal('message'),messageId:z.string(),role:z.literal('user'),parts:z.array(z.record(z.unknown())).min(1),contextId:z.string().optional(),taskId:z.string().optional()}).passthrough()}).passthrough()},false,a=>this.a2a(a.agent_id,'message/send',a.params));
    register('get_task','A2A 0.3 tasks/get.',{...agent,task_id:z.string()},true,a=>this.a2a(a.agent_id,'tasks/get',{id:a.task_id}));
    register('cancel_task','A2A 0.3 tasks/cancel. Messaging cancellation stops local waiting only.',{...agent,task_id:z.string()},false,a=>this.a2a(a.agent_id,'tasks/cancel',{id:a.task_id}));
    return server;
  }
}
