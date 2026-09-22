import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface RecentChat { id:string; name:string; recipient:string; timestamp:number }
const direct=(id:string)=>/^[1-9]\d{0,29}@(s\.whatsapp\.net|lid|bot)$/.test(id) && (!id.endsWith('@s.whatsapp.net') || /^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(id));
const phone=(id:string)=>/^\d{7,15}@s\.whatsapp\.net$/.test(id)?'+'+id.split('@')[0]:'';
const displayName=(...values:any[])=>values.find(value=>typeof value==='string' && value.trim() && value!=='WhatsApp conversation' && !value.startsWith('Unnamed chat · ') && !/^\+?\d+$/.test(value)) || '';
const seconds=(value:any)=>{const n=Number(value?.toString?.() ?? 0);return Number.isFinite(n)?n:0;};
/** Picker metadata only; never stores message bodies. */
export class WhatsAppChats {
  private chats=new Map<string,RecentChat>();
  private contacts=new Map<string,{name:string;recipient:string}>();
  constructor(private directory:string) {
    try {const saved=JSON.parse(readFileSync(join(directory,'recent-chats.json'),'utf8'));
      if(!Array.isArray(saved)) this.updateContacts(saved.contacts ?? []);
      for(const row of (Array.isArray(saved)?saved:saved.chats ?? [])) {
      if(typeof row.id==='string' && direct(row.id) && typeof row.name==='string' && typeof row.recipient==='string' && Number.isFinite(row.timestamp)) this.chats.set(row.id,{id:row.id,name:row.name,recipient:row.recipient,timestamp:row.timestamp});
    }
      this.updateChats([...this.chats.values()]);
    } catch {}
  }
  hasNames() { return [...this.contacts.values()].some(c=>!!displayName(c.name)); }
  addressMatches(id:string,recipient:string) {
    const expected=recipient.startsWith("+")?recipient.slice(1)+"@s.whatsapp.net":recipient;
    return id===expected || (!!this.contacts.get(id)?.recipient && this.contacts.get(id)?.recipient===(recipient.startsWith("+")?recipient:this.contacts.get(expected)?.recipient));
  }
  list() {
    const unique=new Map<string,RecentChat>();
    for(const chat of [...this.chats.values()].sort((a,b)=>b.timestamp-a.timestamp)) {
      const key=chat.recipient || chat.id;
      if(!unique.has(key)) unique.set(key,chat);
    }
    return [...unique.values()].slice(0,200).map(chat=>({...chat,name:chat.name==='WhatsApp conversation'?`Unnamed chat · ${chat.id.split('@')[0]}`:chat.name,recipient:chat.recipient || chat.id}));
  }
  updateContacts(contacts:any[]) {
    for(const c of contacts) {
      if(!c.id || !direct(c.id)) continue;
      // phoneNumber is how the library links a LID contact to its phone number.
      const ids=[c.id,c.lid,c.lidJid,c.jid,c.pnJid,c.phoneNumber].filter(id=>typeof id==='string' && direct(id));
      const old=ids.map(id=>this.contacts.get(id)).find(info=>info?.name) ?? this.contacts.get(c.id);
      const info={name:displayName(c.name,c.displayName,c.notify,c.verifiedName,old?.name),recipient:phone(c.pnJid || c.phoneNumber || c.jid || c.id) || old?.recipient || ''};
      for(const id of ids) {
        this.contacts.set(id,info);
        const chat=this.chats.get(id);
        if(chat) this.chats.set(id,{...chat,name:info.name || chat.name,recipient:info.recipient || chat.recipient});
      }
    }
    while(this.contacts.size>5000) this.contacts.delete(this.contacts.keys().next().value!);
  }
  updateChats(chats:any[]) {
    for(const c of chats) {
      if(!c.id || !direct(c.id)) continue;
      this.updateContacts([{id:c.id,name:c.name || c.displayName,lid:c.lidJid,jid:c.pnJid}]);
      const old=this.chats.get(c.id), contact=this.contacts.get(c.id);
      const recipient=phone(c.id) || contact?.recipient || old?.recipient || '';
      this.chats.set(c.id,{id:c.id,name:contact?.name || c.name || c.displayName || old?.name || recipient || 'WhatsApp conversation',recipient,
        timestamp:Math.max(old?.timestamp ?? 0,seconds(c.conversationTimestamp),seconds(c.lastMessageRecvTimestamp),seconds(c.lastMsgTimestamp))});
    }
    for(const row of [...this.chats.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(500)) this.chats.delete(row.id);
  }
  updateMessages(messages:any[]) {
    for(const m of messages) {
      const id=m.key?.remoteJid; if(!id || !direct(id)) continue;
      this.updateContacts([{id,jid:m.key.remoteJidAlt,...(!m.key.fromMe?{notify:m.pushName,verifiedName:m.verifiedBizName}:{})}]);
      this.updateChats([{id,conversationTimestamp:m.messageTimestamp}]);

    }
  }
  delete(ids:string[]) {for(const id of ids) this.chats.delete(id);}
  clear() {this.chats.clear();this.contacts.clear();}
  save() {
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,'recent-chats.json');
    writeFileSync(path+'.tmp',JSON.stringify({chats:[...this.chats.values()],contacts:[...this.contacts.entries()].map(([id,info])=>({id,name:info.name,jid:info.recipient?info.recipient.slice(1)+'@s.whatsapp.net':undefined}))}),{mode:0o600});renameSync(path+'.tmp',path);
  }
}
