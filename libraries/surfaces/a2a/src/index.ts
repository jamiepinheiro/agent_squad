import { randomUUID } from 'node:crypto';
import { AgentSchema, fail, type Agent, type Message, type SecretReader, type Session, type TaskSurface, type TurnUpdate } from '@agent-squad/kernel';
import { A2AClient } from './a2a.js';
import { deduplicateNativeReplies } from './native-replies.js';
import { a2aPhotoCandidates } from './photos.js';
export { A2AClient, deduplicateNativeReplies, a2aPhotoCandidates };

export function validateA2A(input:Agent):Agent {
  const agent=AgentSchema.parse(input);
  try {const u=new URL(agent.endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash) throw Error();}
  catch {throw Error('Enter an HTTP or HTTPS A2A JSON-RPC endpoint.');}
  if(agent.a2aVersion!==undefined && !['0.3','1.0'].includes(String(agent.a2aVersion))) throw Error('Unsupported A2A protocol version.');
  if(agent.a2aTenant!==undefined && (typeof agent.a2aTenant!=='string'||agent.a2aTenant.length>300)) throw Error('Invalid A2A tenant.');
  return {...agent,a2aVersion:agent.a2aVersion ?? '0.3',a2aTenant:agent.a2aTenant ?? ''};
}
export function taskUpdate(result:any):TurnUpdate {
  const messages:Message[]=[];
  const append=(message:any)=>{
    const text=(message.parts ?? []).filter((p:any)=>p.kind==='text').map((p:any)=>p.text).join('\n');
    if(text) messages.push({id:message.messageId || randomUUID(),role:'agent',text,timestamp:new Date().toISOString()});
  };
  if(result.kind==='message') {append(result);return {status:'completed',contextId:result.contextId,messages,raw:result};}
  if(result.kind!=='task'||typeof result.id!=='string') fail('Expected an A2A Task or Message.');
  const state=result.status?.state;
  const status=({completed:'completed',canceled:'canceled',failed:'failed',rejected:'failed','input-required':'input-required','auth-required':'input-required',submitted:'working',working:'working'} as Record<string,Session['status']>)[state] ?? fail('Unsupported A2A task state.');
  for(const message of result.history ?? []) if(message.role==='agent') append(message);
  if(result.status?.message?.role==='agent') append(result.status.message);
  for(const artifact of result.artifacts ?? []) append({messageId:'artifact:'+result.id+':'+artifact.artifactId,parts:artifact.parts});
  return {status,contextId:result.contextId,remoteTaskId:result.id,messages,raw:result,...(status==='failed'?{error:'The remote agent reported '+state+'.'}:{})};
}
export function createA2ASurface(options:{secret?:SecretReader;client?:A2AClient}={}):TaskSurface {
  const client=options.client ?? new A2AClient(options.secret ?? (async()=>undefined));
  return {
    id:'a2a',kind:'task',validate:validateA2A,conversationKeys:()=>[],profilePhotoSource:'reply',
    prepare:async(agent,credential)=>{const result=await client.validate(agent,credential);return {...agent,a2aVersion:result.protocolVersion,a2aTenant:result.tenant};},
    card:agent=>client.card(agent),rpc:(agent,method,params)=>client.call(agent,method,params),
    tasks:{send:async(...args)=>taskUpdate(await client.send(...args)),get:async(...args)=>taskUpdate(await client.get(...args)),cancel:async(...args)=>taskUpdate(await client.cancel(...args))},
    normalizeSession:session=>{session.messages=deduplicateNativeReplies(session.messages);},
    photoCandidates:a2aPhotoCandidates,
    management:{validateA2A:input=>client.validate(validateA2A(AgentSchema.parse({...input.agent,name:input.agent?.name?.trim() || 'Agent',adapterType:'a2a'})),typeof input.credential==='string'&&input.credential?input.credential:undefined)},
  };
}
