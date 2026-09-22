import type { BotSecretReader } from './whatsapp-pairing.js';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { proto, generateMessageIDV2, encodeSignedDeviceIdentity, getBinaryNodeChild, jidNormalizedUser, jidDecode, jidEncode, unpadRandomMax16, type BinaryNode, type WASocket } from '@whiskeysockets/baileys';

type Secret = { bot:string; sender:string; secret:string; root?:boolean; session?:boolean; thread?:string };
// WhatsApp's default Muse/Hatch bot uses a pairing-secret envelope.
const museBotAddress='1807055946647697@bot';
const botAddress=(jid:string)=>/^[1-9]\d{0,29}@bot$/.test(jid);
const derive=(secret:Uint8Array,info:string)=>Buffer.from(hkdfSync('sha256',secret,Buffer.alloc(0),Buffer.from(info),32));

function unifiedText(data:Uint8Array):string|undefined {
  if(data.length>2_000_000) return;
  try {
    const response=JSON.parse(Buffer.from(data).toString('utf8'));
    if(!Array.isArray(response.sections)) return;
    const texts:string[]=[];
    let remaining=10000;
    const visit=(value:any,depth:number)=>{
      if(!value || typeof value!=='object' || depth>16 || --remaining<0) return;
      if(value.__typename==='GenAIMarkdownTextUXPrimitive' && typeof value.text==='string') {texts.push(value.text);return;}
      for(const child of Object.values(value)) visit(child,depth+1);
    };
    for(const section of response.sections) visit(section.view_model,0);
    return texts.join('\n\n') || undefined;
  } catch {return;}
}

export function botText(message:proto.IMessage|null|undefined):string|undefined {
  for(let depth=0;message && depth<8;depth++) {
    const text=message.conversation ?? message.extendedTextMessage?.text;
    if(text) return text;
    const rich=message.richResponseMessage;
    const unified=rich?.unifiedResponse?.data;
    const richText=(unified && unifiedText(unified)) || rich?.submessages?.map(m=>m.messageText).filter(Boolean).join('\n\n');
    if(richText) return richText;
    message=message.protocolMessage?.editedMessage ?? message.botTaskMessage?.message ?? message.botInvokeMessage?.message ?? message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.editedMessage?.message;
  }
}

// The secret of a prompt we sent, wherever its wrappers put it (bounded; only 32-byte secrets).
function messageSecret(message:unknown,depth=0):Uint8Array|undefined {
  if(!message || typeof message!=='object' || depth>8 || message instanceof Uint8Array) return;
  const own=(message as any).messageContextInfo?.messageSecret;
  if(own instanceof Uint8Array && own.length===32) return own;
  // Quoted messages sit under contextInfo and carry their own, unrelated secrets.
  for(const [key,value] of Object.entries(message)) if(!['messageContextInfo','contextInfo','quotedMessage'].includes(key)) {
    const found=messageSecret(value,depth+1);
    if(found) return found;
  }
}
// Field paths for diagnostics; never values.
function fieldPaths(message:unknown,prefix='',depth=0,out:string[]=[]):string[] {
  if(!message || typeof message!=='object' || message instanceof Uint8Array || depth>6 || out.length>80) return out;
  for(const [key,value] of Object.entries(message)) {
    if(value===null || value===undefined) continue;
    const path=prefix?`${prefix}.${key}`:key;
    out.push(path);fieldPaths(value,path,depth+1,out);
  }
  return out;
}

/** Bot transport using the socket's Signal implementation without rewriting @bot. */
export class WhatsAppBots {
  private secrets:Record<string,Secret>={};
  private requested=new Set<string>();
  private pending=new Map<string,BinaryNode>();
  // Diagnostics only; records message IDs, never content.
  constructor(private directory:string,private log:(info:object,message:string)=>void=()=>{},private recoverSecret:BotSecretReader=async()=>undefined) {
    try {
      const saved=JSON.parse(readFileSync(join(directory,'bot-message-secrets.json'),'utf8'));
      for(const [id,value] of Object.entries(saved) as [string,Secret][]) {
        if(botAddress(value.bot) && typeof value.sender==='string' && typeof value.secret==='string' && Buffer.from(value.secret,'base64').length===32) this.secrets[id]=value;
      }
    } catch {}
  }
  clear() {this.secrets={};this.requested.clear();this.pending.clear();}
  private save() {
    // Replies may use the original chat-registration secret for every future turn.
    // Retain those roots separately from the bounded cache of recent prompts.
    const entries=Object.entries(this.secrets);
    this.secrets=Object.fromEntries([...entries.filter(([,s])=>s.root),...entries.filter(([,s])=>!s.root).slice(-200)]);
    const path=join(this.directory,'bot-message-secrets.json');
    writeFileSync(path+'.tmp',JSON.stringify(this.secrets),{mode:0o600});renameSync(path+'.tmp',path);
  }
  remember(messages:proto.IWebMessageInfo[],sender:string) {
    let changed=false;
    for(const item of messages) {
      const message=item.message,bot=message?.deviceSentMessage?.destinationJid || item.key?.remoteJid || '';
      const id=item.key?.id;
      if(!item.key?.fromMe || !id || !botAddress(bot) || this.secrets[id]) continue;
      // A chat's registration prompt carries its secret inside a wrapper, not beside the text.
      const secret=messageSecret(message);
      if(!secret) {this.log({id,paths:fieldPaths(message)},'own bot message without a secret');continue;}
      // Muse keys every reply to the welcome request that paired it, so that secret is the session.
      // The phone tags each Muse prompt with its AI thread; reuse it so the Mac joins the same conversation.
      const thread=message?.messageContextInfo?.threadId?.find(t=>t.threadKey?.id)?.threadKey?.id ?? undefined;
      this.secrets[id]={bot,sender:jidNormalizedUser(sender),secret:Buffer.from(secret).toString('base64'),root:true,...(thread?{thread}:{})};changed=true;
      this.log({id},'remembered a bot prompt secret');
    }
    if(changed) this.save();
  }
  takePending() {
    const ready:BinaryNode[]=[];
    for(const [id,node] of this.pending) {
      if(this.secrets[getBinaryNodeChild(node,'meta')?.attrs.target_id || '']) {ready.push(node);this.pending.delete(id);}
    }
    return ready;
  }
  async send(socket:WASocket,bot:string,text:string) {
    if(!botAddress(bot)) throw Error('Invalid WhatsApp bot address.');
    const me=socket.authState.creds.me;
    if(!me?.id) throw Error('WhatsApp is not connected.');
    const id=generateMessageIDV2(me.id),secret=randomBytes(32);
    const available=await socket.getBotListV2();
    const personaId=available.find(item=>item.jid===bot)?.personaId;
    const message:proto.IMessage={
      conversation:text,
      messageContextInfo:{messageSecret:secret,botMetadata:{
        ...(personaId?{personaId}:{}),
        capabilityMetadata:{capabilities:[proto.BotCapabilityMetadata.BotCapabilityType.RICH_RESPONSE_UNIFIED_RESPONSE]},
      }},
    };
    // Query by user, not by our own device JID: the library treats a JID with a device number as
    // that single device and skips the lookup. Migrated accounts enumerate own devices by LID.
    const ownDevices=await socket.getUSyncDevices([jidNormalizedUser(me.lid || me.id)],true,false);
    // A migrated account keys its own-device sessions by its LID. Addressing the self copy by
    // phone number instead builds a parallel session the other devices cannot decrypt, which
    // WhatsApp renders as "Waiting for this message".
    const lidUser=me.lid?jidDecode(me.lid)?.user:undefined;
    const myDevice=jidDecode(me.id)?.device ?? 0;
    const ownJids=[...new Set(ownDevices.filter(d=>(d.device ?? 0)!==myDevice).map(d=>jidEncode(lidUser ?? d.user,lidUser?'lid':'s.whatsapp.net',d.device)))];
    await socket.assertSessions([bot,...ownJids],false);
    let botMessage=message;
    if(bot===museBotAddress) {
      // Muse uses a pairing-secret envelope inside the Signal transport. Own-device copies are
      // ordinary text, but the bot recipient requires SecretEncryptedMessage; a transport ACK
      // alone does not mean Muse could read the prompt.
      const session=Object.entries(this.secrets).find(([,s])=>s.bot===bot && s.session);
      if(!session) throw Error('Muse’s message-encryption key has not synced. Open Muse’s chat in WhatsApp for Mac, then refresh conversations in Agent Squad.');
      const [targetId,saved]=session,sender=jidNormalizedUser(me.lid || me.id);
      if(sender!==saved.sender) throw Error('Muse’s pairing belongs to a different WhatsApp identity. Reconnect WhatsApp.');
      // Older builds mistakenly cached the welcome request's linking credential as a message key.
      // Prefer the exact outgoing message's native key when available; no other chat is queried.
      const recovered=await this.recoverSecret(bot,targetId);
      const sessionSecret=recovered?.length===32?recovered:Buffer.from(saved.secret,'base64');
      const key=derive(derive(sessionSecret,'Bot Message'),id+sender+bot);
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
      cipher.setAAD(Buffer.from(id+'\0'+sender));
      const encPayload=Buffer.concat([cipher.update(proto.Message.encode(message).finish()),cipher.final(),cipher.getAuthTag()]);
      botMessage={secretEncryptedMessage:{targetMessageKey:{remoteJid:bot,fromMe:true,id:targetId},encPayload,encIv:iv}};
    }
    const botNodes=await socket.createParticipantNodes([bot],botMessage);
    const selfNodes=await socket.createParticipantNodes(ownJids,{deviceSentMessage:{destinationJid:bot,message:{conversation:text}},messageContextInfo:message.messageContextInfo});
    const content:BinaryNode[]=[{tag:'participants',attrs:{},content:[...botNodes.nodes,...selfNodes.nodes]}];
    if(botNodes.shouldIncludeDeviceIdentity || selfNodes.shouldIncludeDeviceIdentity) {
      content.push({tag:'device-identity',attrs:{},content:encodeSignedDeviceIdentity(socket.authState.creds.account!,true)});
    }
    this.secrets[id]={bot,sender:jidNormalizedUser(me.lid || me.id),secret:secret.toString('base64')};this.save();
    const result=await socket.query({tag:'message',attrs:{id,to:bot,type:'text'},content},20000);
    if(result?.attrs?.error) throw Error(`WhatsApp rejected the bot message (${result.attrs.error}).`);
    return id;
  }
  async receive(socket:WASocket,node:BinaryNode):Promise<proto.IWebMessageInfo|undefined> {
    const bot=node.attrs.from,id=node.attrs.id;
    if(!bot || !id || !botAddress(bot)) return;
    const enc=getBinaryNodeChild(node,'enc');
    if(!enc || !(enc.content instanceof Uint8Array)) return;
    let decoded:proto.IMessage;
    if(enc.attrs.type==='msmsg') {
      const meta=getBinaryNodeChild(node,'meta')?.attrs ?? {};
      let saved=this.secrets[meta.target_id!];
      const targetId=meta.target_id;
      let recovered:Uint8Array|undefined;
      const recover=async()=>{
        if(!targetId) return;
        const candidate=await this.recoverSecret(bot,targetId).catch(()=>undefined);
        if(candidate?.length===32) recovered=candidate;
        return recovered;
      };
      if(!saved && await recover()) {
        const me=socket.authState?.creds?.me;
        saved={bot,sender:jidNormalizedUser(meta.target_sender_jid || me?.lid || me?.id || ''),secret:Buffer.from(recovered!).toString('base64')};
      }
      if(!saved) {
        if(meta.target_id && !this.requested.has(meta.target_id)) {
          this.requested.add(meta.target_id);
          if(this.requested.size<=100) {
            // The phone only honours a resend request that names the message's sender, as WhatsApp
            // Web does; the library leaves it out and the phone stays silent.
            const me=socket.authState?.creds?.me;
            const participant=jidNormalizedUser(meta.target_sender_jid || me?.lid || me?.id || '');
            void socket.requestPlaceholderResend({remoteJid:bot,fromMe:true,id:meta.target_id,participant})
              .then(result=>this.log({targetId:meta.target_id,result},'requested the bot prompt this reply is keyed to'))
              .catch(error=>this.log({targetId:meta.target_id,error},'could not request the bot prompt this reply is keyed to'));
            // Bot chats are left out of history sync, but the phone answers an on-demand sync of the
            // chat, which carries our own prompts together with their secrets.
            void socket.fetchMessageHistory?.(50,{remoteJid:bot,fromMe:false,id},(Number(node.attrs.t) || Math.floor(Date.now()/1000))*1000)
              .then(result=>this.log({targetId:meta.target_id,result},'requested the bot chat history before this reply'))
              .catch(error=>this.log({targetId:meta.target_id,error},'could not request the bot chat history'));
          }
        }
        this.log({replyId:id,targetId:meta.target_id,knownSecrets:Object.keys(this.secrets).length},'bot reply keyed to an unknown prompt');
        this.pending.set(id,node);
        if(this.pending.size>50) this.pending.delete(this.pending.keys().next().value!);
        throw Error('WhatsApp has not synced this AI chat’s session key. Open the chat in WhatsApp for Mac, then refresh conversations in Agent Squad.');
      }
      if(saved.bot!==bot) return;
      const sender=jidNormalizedUser(meta.target_sender_jid || saved.sender);
      // Each edit has its own encryption ID; edit_target_id is only for display.
      const encrypted=proto.MessageSecretMessage.decode(enc.content);
      const payload=Buffer.from(encrypted.encPayload ?? []);
      if(payload.length<16||encrypted.encIv?.length!==12) throw Error('Invalid WhatsApp encrypted reply.');
      const decrypt=(secret:Uint8Array)=>{
        const key=derive(derive(secret,'Bot Message'),id+sender+bot);
        const cipher=createDecipheriv('aes-256-gcm',key,encrypted.encIv!);
        cipher.setAAD(Buffer.from(id+'\0'+bot));cipher.setAuthTag(payload.subarray(-16));
        return proto.Message.decode(Buffer.concat([cipher.update(payload.subarray(0,-16)),cipher.final()]));
      };
      let verifiedSecret=Buffer.from(saved.secret,'base64');
      try {decoded=decrypt(verifiedSecret);}
      catch(error) {
        if(recovered||!await recover()) throw error;
        decoded=decrypt(recovered!);verifiedSecret=Buffer.from(recovered!);
      }
      // Persist recovery only after this key authenticates a real reply for this bot and target.
      if(!this.secrets[targetId!] || !saved.session || recovered) {
        this.secrets[targetId!]={...saved,secret:verifiedSecret.toString('base64'),root:true,session:true};
        this.save();this.log({targetId,recovered:!!recovered},'bot message key authenticated');
      }
    } else if(enc.attrs.type==='pkmsg' || enc.attrs.type==='msg') {
      const bytes=await socket.signalRepository.decryptMessage({jid:bot,type:enc.attrs.type,ciphertext:enc.content});
      decoded=proto.Message.decode(unpadRandomMax16(bytes));
    } else return;
    const edit=getBinaryNodeChild(node,'bot')?.attrs ?? {};
    // Muse streams a first response and a final edit. Publish only the final
    // version so the router's quiet timer cannot finish in the middle of a reply.
    if(edit.edit==='first' || edit.edit==='inner') return;
    const displayId=edit.edit_target_id || decoded.protocolMessage?.key?.id || id;
    return {key:{remoteJid:bot,fromMe:false,id:displayId},pushName:node.attrs.notify,messageTimestamp:Number(node.attrs.t)||Math.floor(Date.now()/1000),message:decoded};
  }
}
