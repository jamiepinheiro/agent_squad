import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSchema, type State } from './types.js';

/** Single writer: every mutation commits a full snapshot using atomic rename. */
export class Store {
  state:State;
  constructor(readonly directory:string) {
    mkdirSync(directory,{recursive:true, mode:0o700});
    chmodSync(directory,0o700);
    const file=join(directory,'state.json');
    this.state=existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) as State : {version:1, agents:[], sessions:[]};
    if(this.state.version!==1 || !Array.isArray(this.state.sessions)) throw Error('Unsupported or damaged state file. Restore state.json from a backup.');
    this.state.agents=this.state.agents.map(a=>AgentSchema.parse(a));
    for(const a of this.state.agents) if(a.profilePhotoStatus==='loading') a.profilePhotoStatus='unavailable';
    for(const s of this.state.sessions) if(s.status==='working') {
      s.status='interrupted'; s.error='Agent Squad restarted during this turn. Check the conversation before sending again.';
    }
    this.save();
  }
  save() {
    const file=join(this.directory,'state.json');
    writeFileSync(file+'.tmp',JSON.stringify(this.state,null,2),{mode:0o600});
    renameSync(file+'.tmp',file);
  }
}
