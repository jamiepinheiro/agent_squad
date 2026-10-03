// Muse Noise XX / service framing, based on the Meta Muse Gadget SDK (Apache-2.0).
import {generateKeyPairSync,createPublicKey,diffieHellman,randomBytes} from 'node:crypto';
import {sha,hmac,seal,open,nonce} from './pairing.js';
const empty=Buffer.alloc(0);
function keys(ck:Buffer,input:Buffer):[Buffer,Buffer]{const prk=hmac(ck,input),a=hmac(prk,Buffer.from([1]));return [a,hmac(prk,Buffer.concat([a,Buffer.from([2])]))];}
export class Cipher {
  private n=0n;private dead=false;
  constructor(private key:Buffer){}
  crypt(data:Buffer,ad:Buffer=empty,decrypt=false):Buffer {if(this.dead||this.n>=9007199254740991n)throw Error('Noise session ended');try{return (decrypt?open:seal)(this.key,nonce(0,this.n++),ad,data);}catch(e){this.dead=true;throw e;}}
}
function keypair(){const p=generateKeyPairSync('x25519');return {...p,raw:p.publicKey.export({type:'spki',format:'der'}).subarray(-32)};}
function dh(key:ReturnType<typeof keypair>,pub:Buffer){if(pub.length!==32)throw Error('Bad Noise public key');return diffieHellman({privateKey:key.privateKey,publicKey:createPublicKey({format:'der',type:'spki',key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),pub])})});}
export class NoiseHandshake {
  private h:Buffer;private ck:Buffer;private cipher?:Cipher;private e=keypair();private phase=0;
  constructor(){this.h=Buffer.alloc(32);Buffer.from('Noise_XX_25519_AESGCM_SHA256').copy(this.h);this.ck=this.h;this.hash(empty);}
  private hash(data:Buffer){this.h=sha(Buffer.concat([this.h,data]));}
  private mix(data:Buffer){const [ck,k]=keys(this.ck,data);this.ck=ck;this.cipher=new Cipher(k);}
  private crypt(data:Buffer,decrypt=false){const result=this.cipher?this.cipher.crypt(data,this.h,decrypt):data;this.hash(decrypt?data:result);return result;}
  first(){if(this.phase++!==0)throw Error('Handshake order');this.hash(this.e.raw);this.crypt(empty);return this.e.raw;}
  finish(data:Buffer){if(this.phase++!==1||data.length<96)throw Error('Invalid Noise handshake');try{const re=data.subarray(0,32);this.hash(re);this.mix(dh(this.e,re));const rs=this.crypt(data.subarray(32,80),true);this.mix(dh(this.e,rs));this.crypt(data.subarray(80),true);const s=keypair();const enc=this.crypt(s.raw);this.mix(dh(s,re));const final=Buffer.concat([enc,this.crypt(empty)]);const [tx,rx]=keys(this.ck,empty);return {final,send:new Cipher(tx),receive:new Cipher(rx)};}catch(e){this.phase=99;throw e;}}
}
export function vint(n:number|bigint){let x=BigInt.asUintN(64,BigInt(n)),a:number[]=[];do{let b=Number(x&127n);x>>=7n;a.push(b|(x?128:0));}while(x);return Buffer.from(a);}
export function field(n:number,value:Buffer|string|number|bigint):Buffer {if(typeof value==='number'||typeof value==='bigint')return Buffer.concat([vint(n*8),vint(value)]);const b=typeof value==='string'?Buffer.from(value):value;return Buffer.concat([vint(n*8+2),vint(b.length),b]);}
export function parse(b:Buffer){const out=new Map<number,Buffer|bigint>();let i=0;function read(){let n=0n;for(let j=0;j<10;j++){if(i>=b.length)throw Error('Truncated protobuf');const x=b[i++]!;n|=BigInt(x&127)<<BigInt(7*j);if(!(x&128))return n;}throw Error('Invalid protobuf');}while(i<b.length){const tag=Number(read()),f=tag>>3,w=tag&7;if(!f)throw Error('Invalid field');if(w===0)out.set(f,read());else if(w===2){const len=Number(read());if(len<0||len>b.length-i)throw Error('Invalid length');out.set(f,b.subarray(i,i+len));i+=len;}else if(w===1||w===5){i+=w===1?8:4;if(i>b.length)throw Error('Truncated field');}else throw Error('Unsupported field');}return out;}
export const bytes=(m:Map<number,Buffer|bigint>,n:number)=>{const v=m.get(n);return Buffer.isBuffer(v)?v:empty;};
export const number=(m:Map<number,Buffer|bigint>,n:number,fallback=0)=>{const v=m.get(n);return typeof v==='bigint'?Number(v):fallback;};
export class NoiseFrames {
  private pending=new Map<string,{parts:Map<number,Buffer>;count:number;size:number;time:number}>();
  constructor(private tx:Cipher,private rx:Cipher){}
  encode(stream:number,kind:number,body:Buffer){const payload=field(2,Buffer.concat([field(1,stream),field(kind,body)]));const count=Math.max(1,Math.ceil(payload.length/65489));if(count>256)throw Error('Message too large');const id=randomBytes(8).readBigUInt64BE();return Array.from({length:count},(_,i)=>this.tx.crypt(Buffer.concat([field(1,id),field(2,i),field(3,count),field(4,payload.subarray(i*65489,(i+1)*65489))])));}
  decode(data:Buffer){const frame=parse(this.rx.crypt(data,empty,true)),id=String(frame.get(1)??0),index=number(frame,2),count=number(frame,3,1),payload=bytes(frame,4);for(const [k,v] of this.pending)if(Date.now()-v.time>60000)this.pending.delete(k);if(count<1||count>256||index>=count||index<0||payload.length>65489)throw Error('Invalid Noise frame');let a=this.pending.get(id);if(!a){if(this.pending.size>=16)throw Error('Too many partial messages');a={parts:new Map(),count,size:0,time:Date.now()};this.pending.set(id,a);}if(a.count!==count||a.parts.has(index))throw Error('Repeated Noise frame');a.parts.set(index,payload);a.size+=payload.length;if(a.size>16*1024*1024)throw Error('Message too large');if(a.parts.size!==count)return;this.pending.delete(id);const response=parse(Buffer.concat(Array.from({length:count},(_,i)=>a!.parts.get(i)!)));const svc=parse(bytes(response,1));const kind=[3,4,5].find(k=>svc.has(k));if(!kind)throw Error('Unknown response');return {stream:number(svc,1),kind,body:parse(bytes(svc,kind))};}
}
