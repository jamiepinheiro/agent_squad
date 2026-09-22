import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSchema, messageOf, type Agent, type MessagingSurface, type MessagingTransport } from '@agent-squad/kernel';
import { WhatsAppTransport } from './whatsapp.js';
export { WhatsAppTransport } from './whatsapp.js';
export { WhatsAppBots, botText } from './whatsapp-bots.js';
export { WhatsAppChats } from './whatsapp-chats.js';

export function validateWhatsApp(input:Agent):Agent {
  const agent=AgentSchema.parse(input);
  if(!/^(\+[1-9][0-9]{6,14}|[1-9][0-9]{0,29}@(lid|bot))$/.test(agent.recipient)) throw Error('Enter an international phone number (+15551234567) or a WhatsApp conversation ID.');
  return agent;
}
export function createWhatsAppSurface(options:{directory:string;transport?:MessagingTransport}):MessagingSurface {
  const whatsapp=new WhatsAppTransport(options.directory);
  return {
    id:'whatsapp',kind:'messaging',transport:options.transport ?? whatsapp,
    validate:validateWhatsApp,conversationKeys:a=>[a.recipient.toLowerCase()],profilePhotoSource:'reply',
    appState:()=>({whatsapp:{status:whatsapp.status,qr:whatsapp.qr,error:whatsapp.error,chatSyncStatus:whatsapp.chatSyncStatus,chatSyncError:whatsapp.chatSyncError}}),
    start:async()=>{if(existsSync(join(options.directory,'creds.json'))) await whatsapp.connect().catch(e=>{whatsapp.error=messageOf(e);});},
    stop:()=>whatsapp.disconnect(),
    management:{
      refreshWhatsAppChats:()=>{void whatsapp.refreshChats().catch(()=>{});return {status:whatsapp.chatSyncStatus};},
      whatsappRecentChats:()=>whatsapp.recentChats(),
      connectWhatsApp:()=>whatsapp.connect(),disconnectWhatsApp:()=>whatsapp.disconnect(),logoutWhatsApp:()=>whatsapp.logout(),
    },
  };
}
