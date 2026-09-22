import type { Session } from './types.js';

export const PROFILE_PHOTO_PROMPT = 'Please share your profile picture or avatar for your Agent Squad entry. Reply with an image attachment or a single direct HTTPS URL to a PNG, JPEG, GIF, or WebP image. If you do not have one, say so; no need to generate an image.';
const MAX_BYTES=512*1024;

export function imageData(bytes:Buffer):string | undefined {
  if(!bytes.length || bytes.length>MAX_BYTES) return;
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    bytes[0]===255 && bytes[1]===216 && bytes[2]===255?'image/jpeg':
    /^GIF8[79]a/.test(bytes.toString('ascii',0,6))?'image/gif':
    bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'?'image/webp':undefined;
  return mime?`data:${mime};base64,${bytes.toString('base64')}`:undefined;
}

export function photoCandidates(session:Session):string[] {
  const candidates:string[]=[];
  const text=(value:unknown)=>{if(typeof value==='string') candidates.push(...(value.match(/https:\/\/[^\s<>"\)\]]+/g) ?? []));};
  for(const message of session.messages) if(message.role==='agent') {if(message.image) candidates.push(message.image);text(message.text);}
  return [...new Set(candidates)].slice(0,5);
}

export async function loadPhoto(candidate:string,signal:AbortSignal):Promise<string|undefined> {
  if(candidate.startsWith('data:')) {
    const match=candidate.match(/^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
    const encoded=match?.[1];
    return encoded && encoded.length<MAX_BYTES*1.4?imageData(Buffer.from(encoded,'base64')):undefined;
  }
  const url=new URL(candidate);
  if(url.protocol!=='https:' || url.username || url.password) return;
  const response=await fetch(url,{signal,redirect:'error'});
  if(!response.ok || !response.headers.get('content-type')?.startsWith('image/') || Number(response.headers.get('content-length') ?? 0)>MAX_BYTES) {await response.body?.cancel();return;}
  if(!response.body) return;
  const reader=response.body.getReader();const chunks:Buffer[]=[];let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done) break;
      length+=value.length;if(length>MAX_BYTES) return;
      chunks.push(Buffer.from(value));
    }
    return imageData(Buffer.concat(chunks));
  } finally {await reader.cancel();}
}
