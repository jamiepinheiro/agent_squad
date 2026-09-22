import { AgentSchema, messageOf, type Agent, type MessagingSurface, type MessagingTransport } from '@agent-squad/kernel';
import { IMessageTransport } from './imessage.js';
export { IMessageTransport } from './imessage.js';

export function validateIMessage(input:Agent):Agent {
  const agent=AgentSchema.parse(input);
  if(!/^(\+[1-9][0-9]{6,14}|[^\s@]+@[^\s@]+\.[^\s@]+|urn:biz:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(agent.recipient)) throw Error('Enter an international phone number (+15551234567), Apple ID email, or Messages for Business address.');
  if(agent.recipientAliases.some(a=>! /^(\+[1-9][0-9]{6,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(a))) throw Error('Invalid iMessage reply alias.');
  return agent;
}
export function createIMessageSurface(options:{helper?:string;transport?:MessagingTransport}={}):MessagingSurface {
  const native=new IMessageTransport(options.helper ?? '');
  let health='Not checked';
  return {
    id:'imessage',kind:'messaging',transport:options.transport ?? native,
    validate:validateIMessage,conversationKeys:agent=>[agent.recipient,...agent.recipientAliases].map(a=>a.toLowerCase()),profilePhotoSource:'local',
    appState:()=>({imessageHealth:health}),
    management:{
      imessageBusinessChats:()=>native.businessChats(),
      checkIMessage:async()=>{try {return health=await native.health();}catch(error){health=messageOf(error);throw error;}},
      setContactPhoto:(input,host)=>{
        const agent=host.agent(String(input.agentId));
        if(agent.adapterType!=='imessage') throw Error('Contacts photos are only used for iMessage agents.');
        return host.saveAgent({...agent,profilePhoto:input.photo,profilePhotoStatus:'ready'});
      },
    },
  };
}
