// Shared Muse transport crypto and imported device identity (Meta SDK, Apache-2.0).
import {createHash,createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
export const sha=(b:Buffer)=>createHash('sha256').update(b).digest();
export const hmac=(k:Buffer,b:Buffer)=>createHmac('sha256',k).update(b).digest();
export function seal(key:Buffer,nonce:Buffer,ad:Buffer,data:Buffer) {const c=createCipheriv('aes-256-gcm',key,nonce);c.setAAD(ad);return Buffer.concat([c.update(data),c.final(),c.getAuthTag()]);}
export function open(key:Buffer,nonce:Buffer,ad:Buffer,data:Buffer) {if(data.length<16) throw Error('Invalid encrypted record');const c=createDecipheriv('aes-256-gcm',key,nonce);c.setAAD(ad);c.setAuthTag(data.subarray(-16));return Buffer.concat([c.update(data.subarray(0,-16)),c.final()]);}
export function nonce(direction:number,counter:bigint) {const n=Buffer.alloc(12);n[0]=direction;n.writeBigUInt64BE(counter,4);return n;}
export function identity(mac?:string) {if(!mac||!/^([a-f0-9]{2}:){5}[a-f0-9]{2}$/.test(mac)){const b=randomBytes(6);b[0]=(b[0]!&252)|2;mac=[...b].map(v=>v.toString(16).padStart(2,'0')).join(':');}const suffix=mac.replaceAll(':','').slice(-6);return {mac,node_id:'homelink-'+suffix,device_id:'hatch-link:'+mac,name:'MuseGadget'+suffix.toUpperCase()};}
export type Identity=ReturnType<typeof identity>;
