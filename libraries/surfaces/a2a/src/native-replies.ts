import type {Message} from '@agent-squad/kernel';

/** The task's text artifact can repeat its conversational reply. Keep one
 * display copy per turn; the full task/artifact payload remains in remoteResult. */
export function deduplicateNativeReplies(messages:Message[]):Message[] {
  const output:Message[]=[];
  let turn:Message[]=[];
  const flush=()=>{
    const replies=new Set(turn.filter(m=>m.role==='agent' && !m.id.startsWith('artifact:')).map(m=>m.text));
    output.push(...turn.filter(m=>!(m.role==='agent' && m.id.startsWith('artifact:') && replies.has(m.text))));
    turn=[];
  };
  for(const message of messages) {
    if(message.role==='user') flush();
    turn.push(message);
  }
  flush();return output;
}
