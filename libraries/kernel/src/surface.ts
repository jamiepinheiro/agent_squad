import { AgentSchema, fail, type Agent, type Message, type MessagingTransport, type Session, type SessionStatus } from './types.js';

/** A surface may expose setup commands to the private app API, never to MCP. */
export interface SurfaceHost {
  agent(id:string):Agent;
  saveAgent(input:unknown):Agent;
}
export type ManagementAction = (input:Record<string,any>,host:SurfaceHost)=>unknown|Promise<unknown>;
export interface TurnUpdate {
  status:SessionStatus;
  remoteTaskId?:string;
  contextId?:string;
  messages?:Message[];
  error?:string;
  /** Opaque surface payload; the kernel stores but never interprets it. */
  raw?:unknown;
}
interface SurfaceBase {
  id:string;
  /** Synchronous validation also runs for callers that bypass the desktop UI. */
  validate(agent:Agent):Agent;
  /** Optional discovery / credentials validation before saving through the app. */
  prepare?(agent:Agent,credential?:string):Promise<Agent>;
  /** Destinations that must not be registered twice. Empty means independent agents. */
  conversationKeys(agent:Agent):string[];
  profilePhotoSource:'local'|'reply';
  photoCandidates?(session:Session):string[];
  normalizeSession?(session:Session):void;
  card?(agent:Agent):Promise<unknown>;
  /** Optional passthrough of the public A2A facade's supported operations. */
  rpc?(agent:Agent,method:string,params:unknown):Promise<unknown>;
  management?:Record<string,ManagementAction>;
  appState?():Record<string,unknown>;
  start?():void|Promise<void>;
  stop?():void|Promise<void>;
}
export interface MessagingSurface extends SurfaceBase {
  kind:'messaging';
  transport:MessagingTransport;
}
export interface TaskSurface extends SurfaceBase {
  kind:'task';
  tasks:{
    send(agent:Agent,session:Session,text:string,signal:AbortSignal):Promise<TurnUpdate>;
    get(agent:Agent,id:string,signal:AbortSignal):Promise<TurnUpdate>;
    cancel(agent:Agent,id:string):Promise<TurnUpdate>;
  };
}
export type Surface = MessagingSurface|TaskSurface;

/** Explicit dependency injection: the kernel never imports a surface package. */
export class SurfaceRegistry {
  private surfaces=new Map<string,Surface>();
  private actions=new Map<string,ManagementAction>();
  constructor(surfaces:Surface[]) {
    for(const surface of surfaces) {
      if(this.surfaces.has(surface.id)) fail(`Duplicate surface: ${surface.id}`);
      this.surfaces.set(surface.id,surface);
      for(const [name,action] of Object.entries(surface.management ?? {})) {
        if(this.actions.has(name)) fail(`Duplicate surface action: ${name}`);
        this.actions.set(name,action);
      }
    }
  }
  get(id:string):Surface {return this.surfaces.get(id) ?? fail(`Surface is not installed: ${id}`);}
  find(id:string):Surface|undefined {return this.surfaces.get(id);}
  parse(input:unknown):Agent {const agent=AgentSchema.parse(input);return this.get(agent.adapterType).validate(agent);}
  async prepare(input:unknown,credential?:string):Promise<Agent> {
    const agent=this.parse(input),surface=this.get(agent.adapterType);
    return surface.prepare?this.parse(await surface.prepare(agent,credential)):agent;
  }
  appState() {return Object.assign({},...Array.from(this.surfaces.values(),s=>s.appState?.() ?? {}));}
  action(name:string):ManagementAction|undefined {return this.actions.get(name);}
  async start() {await Promise.all(Array.from(this.surfaces.values(),s=>s.start?.()));}
  async stop() {await Promise.allSettled(Array.from(this.surfaces.values(),s=>s.stop?.()));}
}
