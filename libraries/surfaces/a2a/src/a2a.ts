import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Agent, SecretReader, Session } from '@agent-squad/kernel';

const CardSchema=z.object({
  name:z.string(),description:z.string(),url:z.string().url().optional(),
  protocolVersion:z.string().optional(),preferredTransport:z.string().optional(),
  additionalInterfaces:z.array(z.object({url:z.string().url(),transport:z.string()})).optional(),
  supportedInterfaces:z.array(z.object({url:z.string().url(),protocolBinding:z.string(),protocolVersion:z.string(),tenant:z.string().optional()})).optional(),
  capabilities:z.object({}).passthrough(),
  skills:z.array(z.object({id:z.string(),name:z.string(),description:z.string(),tags:z.array(z.string())}).passthrough()),
  supportsAuthenticatedExtendedCard:z.boolean().optional(),
}).passthrough();

/** A2A 0.3 and 1.0 JSON-RPC, normalized to the app's existing task model. */
export class A2AClient {
  constructor(private secret:SecretReader) {}
  async card(agent:Agent,credential?:string,extended=true) {
    const token=credential ?? await this.secret('agent.'+agent.id);
    const url=new URL('/.well-known/agent-card.json',agent.endpoint);
    const response=await fetch(url,{
      redirect:'error',headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      signal:AbortSignal.timeout(15000),
    });
    if(!response.ok) throw Error(`Agent Card discovery returned HTTP ${response.status}.`);
    const card=CardSchema.parse(await response.json());
    if(extended && token && (card.supportsAuthenticatedExtendedCard || card.capabilities.extendedAgentCard)) {
      return CardSchema.parse(await this.call(agent,'agent/getAuthenticatedExtendedCard',{}));
    }
    return card;
  }
  async validate(agent:Agent,credential?:string) {
    let card;
    try { card=await this.card(agent,credential,false); }
    catch(error) {
      throw Error(`Could not verify the A2A Agent Card at ${new URL('/.well-known/agent-card.json',agent.endpoint)}. ${error instanceof z.ZodError ? 'The page is not a valid Agent Card.' : error instanceof Error ? error.message : String(error)}`);
    }
    if(/\/mcp\/?$/.test(new URL(agent.endpoint).pathname)) {
      throw Error('This is an MCP URL. Enter the A2A JSON-RPC endpoint advertised in the Agent Card.');
    }
    const interfaces:{url:string;protocolBinding:string;protocolVersion:string;tenant?:string}[]=card.supportedInterfaces ?? [
      ...(card.url?[{url:card.url,protocolBinding:card.preferredTransport ?? 'JSONRPC',protocolVersion:card.protocolVersion ?? ''}]:[]),
      ...(card.additionalInterfaces ?? []).map(i=>({url:i.url,protocolBinding:i.transport,protocolVersion:card.protocolVersion ?? ''})),
    ];
    const supported=interfaces.filter(i=>i.protocolBinding==='JSONRPC' && /^(0\.3|1\.0)(?:\.|$)/.test(i.protocolVersion));
    if(!supported.length) {
      throw Error(`The Agent Card does not advertise supported A2A 0.3 or 1.0 JSON-RPC. Advertised versions: ${[...new Set(interfaces.map(i=>i.protocolVersion || 'unspecified'))].join(', ') || 'none'}.`);
    }
    const canonical=(value:string)=>{const u=new URL(value);u.pathname=u.pathname.replace(/\/+$/,'') || '/';return u.href;};
    const selected=supported.find(i=>canonical(i.url)===canonical(agent.endpoint));
    if(!selected) {
      throw Error(`This URL is not the A2A endpoint advertised by the Agent Card. Advertised endpoint: ${supported[0]!.url}. If the agent is behind a proxy, its card must advertise the reachable address.`);
    }
    const protocolVersion:'0.3'|'1.0'=selected.protocolVersion.startsWith('1.0')?'1.0':'0.3';
    return {name:card.name,endpoint:agent.endpoint,protocolVersion,tenant:selected.tenant ?? ''};
  }
  async call(agent:Agent,method:string,params:unknown,signal?:AbortSignal):Promise<any> {
    const v1=agent.a2aVersion==='1.0';
    const wireMethod=v1?({'message/send':'SendMessage','tasks/get':'GetTask','tasks/cancel':'CancelTask','agent/getAuthenticatedExtendedCard':'GetExtendedAgentCard'} as Record<string,string>)[method]:method;
    if(!wireMethod) throw Error(`Unsupported A2A method: ${method}`);
    const wireParams=v1?toV1Params(method,params,typeof agent.a2aTenant==='string'?agent.a2aTenant:''):params;
    const token=await this.secret('agent.'+agent.id);
    const id=randomUUID();
    const response=await fetch(agent.endpoint,{
      method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json',...(v1?{'A2A-Version':'1.0'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id,method:wireMethod,params:wireParams}),
      signal:signal ?? AbortSignal.timeout(30000),
    });
    if(!response.ok) throw Error(`A2A endpoint returned HTTP ${response.status}.`);
    const body:any=await response.json();
    if(body.jsonrpc!=='2.0' || body.id!==id) throw Error('Invalid A2A JSON-RPC response.');
    if(body.error) throw Error(`A2A error ${body.error.code}: ${body.error.message}`);
    if(body.result===undefined) throw Error('A2A response has no result.');
    return v1 && method!=='agent/getAuthenticatedExtendedCard'?fromV1Result(method,body.result):body.result;
  }
  send(agent:Agent,session:Session,text:string,signal:AbortSignal) {
    return this.call(agent,'message/send',{
      message:{kind:'message',messageId:randomUUID(),role:'user',contextId:session.contextId,
        ...(session.status==='input-required' && session.remoteTaskId ? {taskId:session.remoteTaskId}:{}),parts:[{kind:'text',text}]},
      configuration:{blocking:false,acceptedOutputModes:['text/plain']},
    },signal);
  }
  get(agent:Agent,id:string,signal?:AbortSignal) { return this.call(agent,'tasks/get',{id,historyLength:100},signal); }
  cancel(agent:Agent,id:string) { return this.call(agent,'tasks/cancel',{id}); }
}

function toV1Params(method:string,input:unknown,tenant:string) {
  const params:Record<string,any>={...(input as Record<string,any>),...(tenant?{tenant}:{})};
  if(method==='message/send') {
    const message=params.message;
    if(!message || !['user','agent'].includes(message.role)) throw Error('A2A requires a user or agent message.');
    const {kind,...fields}=message;
    params.message={...fields,role:message.role==='user'?'ROLE_USER':'ROLE_AGENT',parts:(message.parts ?? []).map((part:any)=>{
      if(part.kind!=='text' || typeof part.text!=='string') throw Error('A2A 1.0 currently supports text messages only.');
      const {kind,...fields}=part;return fields;
    })};
    if(params.configuration) {
      const {blocking,pushNotificationConfig,...fields}=params.configuration;
      params.configuration={...fields,...(blocking!==undefined?{returnImmediately:!blocking}:{})};
      if(pushNotificationConfig) throw Error('A2A push notifications are not supported.');
    }
  }
  return params;
}

function fromV1Message(message:any) {
  const role=message.role==='ROLE_USER' || message.role===1?'user':message.role==='ROLE_AGENT' || message.role===2?'agent':message.role;
  return {...message,kind:'message',role,parts:fromV1Parts(message.parts)};
}
function fromV1Parts(parts:any[]=[]) {
  return parts.map(part=>({...part,...(typeof part.text==='string'?{kind:'text'}:{})}));
}
function fromV1Result(method:string,result:any) {
  if(method==='message/send') {
    if(result?.message && !result.task) return fromV1Message(result.message);
    if(!result?.task || result.message) throw Error('Expected an A2A 1.0 task or message response.');
    result=result.task;
  }
  if(!result || typeof result.id!=='string' || !result.status) throw Error('Expected an A2A 1.0 Task.');
  const numericStates=['unspecified','submitted','working','completed','failed','canceled','input-required','rejected','auth-required'];
  const state=typeof result.status.state==='number'?numericStates[result.status.state]:String(result.status.state).replace(/^TASK_STATE_/,'').toLowerCase().replaceAll('_','-');
  return {...result,kind:'task',status:{...result.status,state,...(result.status.message?{message:fromV1Message(result.status.message)}:{})},
    ...(result.history?{history:result.history.map(fromV1Message)}:{}),
    ...(result.artifacts?{artifacts:result.artifacts.map((artifact:any)=>({...artifact,parts:fromV1Parts(artifact.parts)}))}:{})};
}
