import { z } from 'zod';

export const AgentSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(100),
  adapterType: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  recipient: z.string().max(300).default(''),
  recipientAliases: z.array(z.string().max(300)).max(30).default([]),
  endpoint: z.string().max(2000).default(''),
  profilePhoto: z.string().max(720000).regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  profilePhotoStatus: z.enum(['loading','ready','unavailable']).optional(),
  enabled: z.boolean().default(true),
  quietSeconds: z.number().min(1).max(120).default(8),
  timeoutSeconds: z.number().min(10).max(3600).default(180),
}).passthrough().transform(({description: _legacyDescription, ...agent})=>agent);
export type Agent = z.infer<typeof AgentSchema>;
export type SessionStatus = 'idle'|'working'|'completed'|'failed'|'canceled'|'input-required'|'interrupted';
export interface Message { id: string; role:'user'|'agent'; text:string; timestamp:string; image?:string }
export interface Session {
  id:string; agentId:string; contextId:string; remoteTaskId?:string; status:SessionStatus;
  createdAt:string; updatedAt:string; messages:Message[]; error?:string; remoteResult?:unknown;
}
export const TunnelSchema = z.object({
  tunnelId:z.string().regex(/^tunnel_[a-f0-9]{32}$/),
  executable:z.string().min(1), autoConnect:z.boolean().default(false),
});
export type TunnelConfig = z.infer<typeof TunnelSchema>;
export interface State { version:1; agents:Agent[]; sessions:Session[]; tunnel?:TunnelConfig }
export interface Incoming { id:string; text:string; timestamp:string; image?:string }
export interface MessagingTransport {
  baseline(agent:Agent,signal?:AbortSignal):Promise<string>;
  send(agent:Agent, text:string,signal?:AbortSignal):Promise<void>;
  receive(agent:Agent, after:string,signal?:AbortSignal):Promise<{cursor:string; messages:Incoming[]}>;
}
export type SecretReader = (account:string)=>Promise<string|undefined>;
export function fail(message:string):never { throw new Error(message); }
export function messageOf(error:unknown):string { return error instanceof Error ? error.message : String(error); }
