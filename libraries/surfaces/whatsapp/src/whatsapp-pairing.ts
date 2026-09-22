import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type BotSecretReader = (bot:string,messageId:string)=>Promise<Uint8Array|undefined>;

// WhatsApp's local message metadata stores the message secret in field 68. The secret inside
// REQUEST_WELCOME_MESSAGE is a different linking credential and must never be substituted here.
export function localMessageSecret(bytes:Uint8Array):Uint8Array|undefined {
  if(bytes.length>1_000_000) return;
  let offset=0,secret:Uint8Array|undefined;
  const varint=()=>{
    let value=0;
    for(let shift=0;shift<=49;shift+=7) {
      if(offset>=bytes.length) throw Error('Truncated metadata');
      const byte=bytes[offset++]!;value+=(byte&127)*2**shift;
      if(!Number.isSafeInteger(value)) throw Error('Invalid metadata');
      if(!(byte&128)) return value;
    }
    throw Error('Invalid metadata');
  };
  try {
    while(offset<bytes.length) {
      const tag=varint(),field=Math.floor(tag/8),wire=tag%8;
      if(field<1) return;
      if(wire===0) {varint();continue;}
      const length=wire===2?varint():wire===1?8:wire===5?4:-1;
      if(length<0||length>bytes.length-offset) return;
      if(field===68&&wire===2) {
        if(length!==32||secret) return;
        secret=bytes.slice(offset,offset+length);
      }
      offset+=length;
    }
    return secret;
  } catch {return;}
}

/** Optional recovery from the user's existing WhatsApp for Mac message, never a broad chat read. */
export async function readLocalBotSecret(bot:string,messageId:string,databasePath=join(homedir(),'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite')):Promise<Uint8Array|undefined> {
  if(!/^[1-9]\d{0,29}@bot$/.test(bot)||!messageId||messageId.length>128||!existsSync(databasePath)) return;
  try {
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(databasePath,{readOnly:true});
    try {
      db.exec('PRAGMA busy_timeout = 1000');
      const rows=db.prepare(`SELECT mi.ZMETADATA AS metadata FROM ZWAMESSAGE m
        JOIN ZWAMEDIAITEM mi ON mi.Z_PK=m.ZMEDIAITEM
        WHERE m.ZSTANZAID=? AND m.ZTOJID=? AND m.ZISFROMME=1 LIMIT 2`).all(messageId,bot);
      if(rows.length!==1||!(rows[0]?.metadata instanceof Uint8Array)) return;
      return localMessageSecret(rows[0].metadata);
    } finally {db.close();}
  } catch {return;} // Optional app/database may be absent, inaccessible, busy, or a different schema.
}
