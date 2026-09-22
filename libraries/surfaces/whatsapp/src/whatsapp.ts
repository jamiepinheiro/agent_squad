import { WhatsAppChats } from './whatsapp-chats.js';
import { WhatsAppBots, botText } from './whatsapp-bots.js';
import makeWASocket, { extractMessageContent, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason, ALL_WA_PATCH_NAMES, type WASocket, type BinaryNode, type proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import { mkdirSync, chmodSync, rmSync } from 'node:fs';
import type { Agent, Incoming, MessagingTransport } from '@agent-squad/kernel';

const defaultRuntime={loadAuth:useMultiFileAuthState,fetchVersion:fetchLatestWaWebVersion,makeSocket:makeWASocket};

export class WhatsAppTransport implements MessagingTransport {
  status='disconnected'; qr:string|null=null; error:string|null=null;
  private socket?:WASocket; private generation=0; private reconnect?:NodeJS.Timeout;
  private handshakeTimer?:NodeJS.Timeout;
  private sequence=0; private inbox:{sequence:number;recipient:string;message:Incoming}[]=[];
  private chats:WhatsAppChats;
  private bots:WhatsAppBots;
  private chatSync?:Promise<void>;
  private lastHistoryReplay=0;
  chatSyncStatus="idle"; chatSyncError:string|null=null;
  constructor(private directory:string,private runtime=defaultRuntime) { this.chats=new WhatsAppChats(directory);this.bots=new WhatsAppBots(directory); }
  recentChats() { return this.chats.list(); }
  async refreshChats():Promise<void> {
    this.requireConnected();
    if(this.chatSync) return this.chatSync;
    const socket=this.socket!, generation=this.generation;
    this.chatSyncStatus='syncing';this.chatSyncError=null;
    this.chatSync=(async()=>{
      try {
        // Rebuild the local app-state snapshot so names received before this
        // picker existed are emitted again. Encryption keys are retained.
        await socket.authState.keys.set({'app-state-sync-version':Object.fromEntries(ALL_WA_PATCH_NAMES.map(name=>[name,null]))});
        await socket.resyncAppState([...ALL_WA_PATCH_NAMES],false);
        // Ask our own primary device to replay already-received history
        // notifications so upgraded parsers can recover fields older builds lost.
        if(!this.lastHistoryReplay) {
          this.lastHistoryReplay=Date.now();
          const history=socket.authState.creds?.processedHistoryMessages ?? [];
          await Promise.all(history.slice(-5).map(item=>socket.requestPlaceholderResend(item.key)));
        }
        if(generation===this.generation) {
          this.chatSyncStatus='ready';
          if(!this.chats.hasNames()) this.chatSyncError='WhatsApp has not shared conversation names yet. Keep WhatsApp open on your phone and refresh again.';
        }
      } catch(error) {
        if(generation===this.generation) {this.chatSyncStatus='failed';this.chatSyncError=error instanceof Error?error.message:String(error);}
        throw error;
      } finally {if(generation===this.generation) this.chatSync=undefined;}
    })();
    return this.chatSync;
  }
  async connect():Promise<void> { await this.open(0); }
  private async open(attempt:number):Promise<void> {
    this.disconnect();
    const generation=this.generation;
    this.status='connecting'; this.error=null;
    let auth:Awaited<ReturnType<typeof useMultiFileAuthState>>;
    let version:Awaited<ReturnType<typeof fetchLatestWaWebVersion>>;
    try {
      mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
      // The library's bundled version becomes obsolete and can fail before QR generation.
      version=await this.runtime.fetchVersion({timeout:10000});
      if(!version.isLatest) throw Error('Could not retrieve the current WhatsApp Web version. Check your internet connection and try again.');
      auth=await this.runtime.loadAuth(this.directory);
    } catch(error) {
      if(generation===this.generation) {this.status='disconnected';this.error=error instanceof Error?error.message:String(error);}
      return;
    }
    if(generation!==this.generation) return;
    const {state,saveCreds}=auth;
    let socket:WASocket;
    try {
      socket=this.runtime.makeSocket({auth:state,version:version.version,logger:pino({level:'silent'}),printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:true,shouldSyncHistoryMessage:()=>true,shouldIgnoreJid:jid=>typeof jid==='string' && jid.endsWith('@bot'),connectTimeoutMs:20000,defaultQueryTimeoutMs:20000});
    } catch(error) {
      this.status='disconnected';this.error=error instanceof Error?error.message:String(error);return;
    }
    this.socket=socket;
    const receiveBot=(node:BinaryNode)=>{
      if(generation!==this.generation || !node.attrs.from?.endsWith('@bot')) return;
      void this.bots.receive(socket,node).then(async message=>{
        if(generation!==this.generation) return;
        // Ignored bot frames never reach Baileys' delivery-receipt path.
        // Confirm delivery (not read) for progress frames and final edits alike
        // so WhatsApp advances its offline queue instead of replaying it.
        await socket.sendMessageAck(node,0);
        await socket.sendReceipt(node.attrs.from!,undefined,[node.attrs.id!],'inactive');
        if(message && generation===this.generation) {
          this.error=null;
          // Bot frames are decoded outside Baileys' processing/flush cycle.
          // Re-emitting into its buffered events can strand a completed reply.
          acceptMessages([message],node.attrs.offline===undefined?'notify':'append');
        }
      }).catch(error=>{if(generation===this.generation) this.error=error instanceof Error?error.message:'Could not decode a WhatsApp AI agent reply.';});
    };
    const rememberBots=(messages:proto.IWebMessageInfo[])=>{
      const me=state.creds?.me;
      if(!me) return;
      this.bots.remember(messages,me.lid || me.id);
      for(const node of this.bots.takePending()) receiveBot(node);
    };
    socket.ws?.on('CB:message',receiveBot);
    this.handshakeTimer=setTimeout(()=>{
      if(generation!==this.generation) return;
      this.disconnect();this.error='WhatsApp did not provide a QR code or complete the connection. Check your internet connection and try again.';
    },30000);
    socket.ev.on('creds.update',()=>{
      if(generation!==this.generation) return;
      void saveCreds().catch(()=>{ if(generation===this.generation) this.error='Could not save WhatsApp credentials.'; });
    });
    socket.ev.on('connection.update',update=>{
      if(generation!==this.generation) return;
      if(update.qr) { clearTimeout(this.handshakeTimer);this.qr=update.qr;this.status='pairing';this.error=null; }
      if(update.connection==='open') { clearTimeout(this.handshakeTimer);attempt=0;this.status='connected';this.qr=null;this.error=null; }
      if(update.connection==='close') {
        clearTimeout(this.handshakeTimer);
        this.qr=null;
        const code=(update.lastDisconnect?.error as any)?.output?.statusCode;
        this.status='disconnected';
        // Invalidate the closed socket before any late QR or credential events arrive.
        ++this.generation;this.socket=undefined;
        if(code===DisconnectReason.loggedOut) {
          this.bots.clear();this.inbox=[];this.chats.clear();rmSync(this.directory,{recursive:true,force:true});this.error='WhatsApp signed out. Connect again to pair this Mac.';return;
        }
        if([403,405,411,440,500].includes(code)) {
          this.error=`WhatsApp rejected the connection (code ${code}). Try connecting again. If this persists, the WhatsApp integration may need an update.`;return;
        }
        if(attempt>=3) {this.error=`WhatsApp could not connect after several attempts${code?` (code ${code})`:''}. Try again when your connection is available.`;return;}
        const delay=code===DisconnectReason.restartRequired ? 1000 : Math.min(5000*2**attempt,20000);
        this.status='reconnecting';this.error=code===DisconnectReason.restartRequired ? 'Completing device pairing…' : `Connection lost${code?` (code ${code})`:''}. Retrying (${attempt+1}/3)…`;
        this.reconnect=setTimeout(()=>{void this.open(attempt+1).catch(e=>{this.error=String(e);});},delay);
      }
    });
    const updateChats=(update:()=>void)=>{
      if(generation!==this.generation) return;
      update();
      if(this.chats.hasNames() && this.chatSyncStatus==='ready') this.chatSyncError=null;
      try {this.chats.save();} catch {this.error='Could not save the recent conversations list.';}
    };
    socket.ev.on('messaging-history.set',event=>updateChats(()=>{
      rememberBots(event.messages);this.chats.updateContacts(event.contacts);this.chats.updateChats(event.chats);this.chats.updateMessages(event.messages);
    }));
    socket.ev.on('chats.upsert',rows=>updateChats(()=>this.chats.updateChats(rows)));
    socket.ev.on('chats.update',rows=>updateChats(()=>this.chats.updateChats(rows)));
    socket.ev.on('chats.delete',ids=>updateChats(()=>this.chats.delete(ids)));
    socket.ev.on('contacts.upsert',rows=>updateChats(()=>this.chats.updateContacts(rows)));
    socket.ev.on('contacts.update',rows=>updateChats(()=>this.chats.updateContacts(rows)));
    const acceptMessages=(messages:proto.IWebMessageInfo[],type:string)=>{
      if(generation!==this.generation) return;
      rememberBots(messages);
      updateChats(()=>this.chats.updateMessages(messages));
      if(type!=='notify') return;
      for(const item of messages) {
        if(!item.key || item.key.fromMe || !item.key.id) continue;
        const jid=(item.key as any).remoteJidAlt || item.key.remoteJid || '';
        if(!/^[1-9]\d*(?::\d+)?@(s\.whatsapp\.net|lid|bot)$/.test(jid)) continue;
        const text=botText(item.message);
        const thumbnail=extractMessageContent(item.message)?.imageMessage?.jpegThumbnail;
        const image=thumbnail?.length ? `data:image/jpeg;base64,${Buffer.from(thumbnail).toString('base64')}` : undefined;
        if(!text && !image) continue;
        // Deduplicate retransmitted notifications before assigning a new cursor.
        if(this.inbox.some(x=>x.message.id===item.key.id && x.recipient===jid)) continue;
        this.inbox.push({sequence:++this.sequence,recipient:jid,message:{id:item.key.id,text:text || 'Image',image,timestamp:new Date().toISOString()}});
      }
      if(this.inbox.length>10000) this.inbox.splice(0,this.inbox.length-10000);
    };
    socket.ev.on('messages.upsert',event=>acceptMessages(event.messages,event.type));
  }
  disconnect() {
    ++this.generation;clearTimeout(this.reconnect);this.reconnect=undefined;clearTimeout(this.handshakeTimer);
    this.socket?.end(undefined);this.socket=undefined;this.status='disconnected';this.qr=null;this.error=null;this.chatSync=undefined;this.chatSyncStatus='idle';this.chatSyncError=null;
  }
  async logout() {
    ++this.generation;clearTimeout(this.reconnect);clearTimeout(this.handshakeTimer);
    const socket=this.socket;this.socket=undefined;
    try {if(socket) await socket.logout();}
    finally {socket?.end(undefined);this.status='disconnected';this.qr=null;this.bots.clear();this.inbox=[];this.chats.clear();rmSync(this.directory,{recursive:true,force:true});}
  }
  async baseline(_agent:Agent) { this.requireConnected(); return String(this.sequence); }
  private requireConnected() { if(this.status!=='connected' || !this.socket) throw Error('Connect WhatsApp in Settings → Connectors before sending a task.'); }
  async send(agent:Agent,text:string) {
    this.requireConnected();
    if(agent.recipient.endsWith('@bot')) await this.bots.send(this.socket!,agent.recipient,text);
    else await this.socket!.sendMessage(agent.recipient.startsWith('+')?agent.recipient.slice(1)+'@s.whatsapp.net':agent.recipient,{text});
  }
  async receive(agent:Agent,after:string) {
    this.requireConnected();
    const cursor=Number(after);
    if(this.inbox[0] && cursor<this.inbox[0].sequence-1) throw Error('WhatsApp receive buffer expired; inspect the conversation before retrying.');
    return {cursor:String(this.sequence),messages:this.inbox.filter(x=>x.sequence>cursor && this.chats.addressMatches(x.recipient,agent.recipient)).map(x=>x.message)};
  }
}
