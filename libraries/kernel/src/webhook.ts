import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';

export class EventError extends Error {
  constructor(message:string,readonly code=-32602,readonly data?:Record<string,string>) {super(message);}
}
export function publicAddress(address:string):boolean {
  if(!ipaddr.isValid(address)) return false;
  const parsed=ipaddr.parse(address);
  // IPv4-mapped, translation, transition, multicast and reserved ranges are excluded.
  return parsed.range()==='unicast';
}
export function callbackURL(value:string):URL {
  let url:URL;
  try {url=new URL(value);} catch {throw new EventError('Invalid callback URL.');}
  if(url.protocol!=='https:' || url.username || url.password || url.hash || (url.port && url.port!=='443')) throw new EventError('Callback must use HTTPS on port 443 without credentials or a fragment.');
  return url;
}
export type WebhookPost=(url:string,body:string,headers:Record<string,string>)=>Promise<{status:number;body:string}>;
export const webhookPost:WebhookPost=async(value,body,headers)=>{
  const url=callbackURL(value),hostname=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=await lookup(hostname,{all:true});
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new EventError('Callback address is not public.',-32015,{reason:'address_blocked'});
  const address=addresses[0]!;
  return new Promise((resolve,reject)=>{
    // Pin the resolved address; TLS still verifies the original hostname. Never follow redirects.
    const req=request(url,{method:'POST',headers,agent:false,lookup:((_host:any,options:any,done:any)=>options.all?done(null,[address]):done(null,address.address,address.family)) as any},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>65536) req.destroy(new Error('Callback response too large.'));else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode ?? 0,body:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(new EventError('Callback timed out.',-32015,{reason:'timeout'})),10000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
  });
};
export function signingKey(secret:string):Buffer {
  const encoded=secret.startsWith('whsec_')?secret.slice(6):'';
  const key=Buffer.from(encoded,'base64');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || key.length<24 || key.length>64 || key.toString('base64').replace(/=+$/,'')!==encoded.replace(/=+$/,'')) throw new EventError('Signing secret must be whsec_ followed by 24–64 base64-encoded bytes.');
  return key;
}
export function signedHeaders(secret:string,id:string,body:string,subscriptionId:string) {
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`,'X-MCP-Subscription-Id':subscriptionId};
}
