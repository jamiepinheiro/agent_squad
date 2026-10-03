import {AgentSchema,type Agent,type SecretReader,type TaskSurface} from '@agent-squad/kernel';
import {NativeMuse} from './native.js';
import {PairingTransfer} from './transfer.js';
export function validateMuseGadget(input:Agent):Agent {
  const agent=AgentSchema.parse(input);
  return {...agent,connection:{mode:'native'}};
}
export function createMuseGadgetSurface(options:{secret?:SecretReader}={}):TaskSurface {
  const muse=new NativeMuse(options.secret??(async()=>undefined));
  const validate=()=>{if(!muse.state().connected)throw Error('Import a Pi pairing and wait for Connected before saving.');return muse.state();};
  // Serialize imports and receiver setup.
  let pending:Promise<unknown>=Promise.resolve();
  const serial=(action:()=>unknown)=>{const next=pending.then(action);pending=next.catch(()=>{});return next;};
  const transfer=new PairingTransfer(value=>serial(()=>muse.importPairing(value)));
  return {
    id:'muse-gadget',kind:'task',validate:validateMuseGadget,conversationKeys:()=>['muse-gadget:native'],profilePhotoSource:'reply',
    start:()=>muse.start(),stop:()=>{transfer.stop();muse.stop();},appState:()=>({museGadget:muse.state()}),
    prepare:async agent=>{validate();return validateMuseGadget(agent);},
    tasks:{send:(a,s,t,signal)=>muse.send(a,s.contextId,t,signal),get:async(_a,id)=>muse.get(id),cancel:async(_a,id)=>muse.cancel(id)},
    management:{
      validateMuseGadget:()=>validate(),museGadgetStatus:()=>muse.state(),
      musePairingImport:input=>serial(()=>muse.importPairing(input.pairing)),
      museTransferStart:()=>serial(()=>transfer.start()),
      museTransferStatus:()=>transfer.state(),
      museTransferStop:()=>{if(transfer.state().receiving)throw Error('Wait for the import to finish.');transfer.stop();return transfer.state();},
    },
  };
}
