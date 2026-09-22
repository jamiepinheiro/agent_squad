import {readFileSync,writeFileSync} from 'node:fs';
const path=new URL('./Utils/decode-wa-message.js',import.meta.resolve('@whiskeysockets/baileys'));
let source=readFileSync(path,'utf8');
const patches=[
  ['if (recipient && !isJidMetaIa(recipient)) {','if (recipient) { // Agent Squad: retain AI bot destinations in own-device copies'],
  ['msg = msg.deviceSentMessage?.message || msg;',`if (msg.deviceSentMessage?.message) {
                            const inner = msg.deviceSentMessage.message;
                            msg = { ...inner, messageContextInfo: { ...msg.messageContextInfo, ...inner.messageContextInfo } };
                        } // Agent Squad: preserve bot session secrets from own-device copies`],
];
for(const [before,after] of patches) {
 if(source.includes(after)) continue;
 if(!source.includes(before)) throw Error('Baileys changed; review the bot compatibility patch before building.');
 source=source.replace(before,after);
}
writeFileSync(path,source);
