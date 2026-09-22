import type { Session } from '@agent-squad/kernel';
export function a2aPhotoCandidates(session:Session):string[] {
  const candidates:string[]=[];
  const text=(value:unknown)=>{if(typeof value==='string') candidates.push(...(value.match(/https:\/\/[^\s<>"\)\]]+/g) ?? []));};
  const parts=(items:any[])=>{for(const part of items ?? []) {
    const file=part.file;
    if(file?.bytes && typeof file.bytes==='string') candidates.push(`data:${file.mimeType ?? 'image/jpeg'};base64,${file.bytes}`);
    if(typeof file?.uri==='string') candidates.push(file.uri);
    if(typeof part.raw==='string') candidates.push(`data:${part.mediaType ?? 'image/jpeg'};base64,${part.raw}`);
    if(typeof part.url==='string') candidates.push(part.url);
    text(part.text);
  }};
  const remote=session.remoteResult as any;
  if(remote) {
    if(remote.role==='agent') parts(remote.parts);
    for(const message of remote.history ?? []) if(message.role==='agent') parts(message.parts);
    if(remote.status?.message?.role==='agent') parts(remote.status.message.parts);
    for(const artifact of remote.artifacts ?? []) parts(artifact.parts);
  }
  return [...new Set(candidates)].slice(0,5);
}
