import { AgentSchema, type MessagingSurface, type Incoming } from '@agent-squad/kernel';

/** An in-memory surface for learning and tests. It never contacts another service. */
export function createEchoSurface():MessagingSurface {
  let sequence=0;
  const replies:{sequence:number;recipient:string;message:Incoming}[]=[];
  return {
    id:'echo',kind:'messaging',profilePhotoSource:'local',
    validate(input) {
      const agent=AgentSchema.parse(input);
      if(!agent.recipient.startsWith('room:')) throw Error('Echo destinations start with room:.');
      return agent;
    },
    conversationKeys:agent=>[agent.recipient],
    transport:{
      async baseline(_agent,signal) {signal?.throwIfAborted();return String(sequence);},
      async send(agent,text,signal) {
        signal?.throwIfAborted();
        replies.push({sequence:++sequence,recipient:agent.recipient,message:{id:String(sequence),text:`Echo: ${text}`,timestamp:new Date().toISOString()}});
      },
      async receive(agent,after,signal) {
        signal?.throwIfAborted();
        return {cursor:String(sequence),messages:replies.filter(r=>r.sequence>Number(after)&&r.recipient===agent.recipient).map(r=>r.message)};
      },
    },
  };
}
