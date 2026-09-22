import { Store } from './store.js';
import { Router } from './router.js';
import { Protocol } from './protocol.js';
import { SurfaceRegistry, type Surface } from './surface.js';

/** App use cases shared by the desktop host and any future host. */
export class Kernel {
  readonly store:Store;
  readonly surfaces:SurfaceRegistry;
  readonly router:Router;
  readonly protocol:Protocol;
  constructor(options:{directory:string;surfaces:Surface[]}) {
    this.surfaces=new SurfaceRegistry(options.surfaces);
    this.store=new Store(options.directory);
    this.router=new Router(this.store,this.surfaces);
    this.protocol=new Protocol(this.router);
  }
  snapshot() {
    return {agents:this.store.state.agents,sessions:[...this.store.state.sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),surfaceState:this.surfaces.appState()};
  }
  async action(input:Record<string,any>):Promise<unknown> {
    const router=this.router;
    switch(input.action) {
      case 'saveAgent': {
        const agent=await this.surfaces.prepare(input.agent);
        const isNew=!router.agents().some(a=>a.id===agent.id);
        const saved=router.saveAgent(agent);
        if(isNew && this.surfaces.get(agent.adapterType).profilePhotoSource==='reply') void router.requestProfilePhoto(agent.id).catch(()=>{});
        return saved;
      }
      case 'refreshProfilePhoto': {
        const agent=router.agent(String(input.agentId));
        if(this.surfaces.get(agent.adapterType).profilePhotoSource==='local') throw Error('Use this surface’s local image picker to refresh the image.');
        if(!agent.enabled) throw Error('Enable this agent before requesting an image.');
        if(agent.profilePhotoStatus==='loading' || router.list(agent.id).some(s=>s.status==='working')) throw Error('Wait for this agent’s current task before refreshing its image.');
        void router.requestProfilePhoto(agent.id,true).catch(()=>{});
        return;
      }
      case 'deleteAgent':return router.deleteAgent(String(input.agentId));
      case 'createSession':return router.create(String(input.agentId));
      case 'sendPrompt':return router.send(String(input.agentId),String(input.sessionId),String(input.prompt ?? ''));
      case 'cancel':return router.cancel(String(input.agentId),String(input.sessionId));
      default:{const action=this.surfaces.action(input.action);if(!action) throw Error('Unknown action.');return action(input,router);}
    }
  }
  async start() {await this.surfaces.start();}
  async stop() {await this.router.shutdown();await this.surfaces.stop();}
}
