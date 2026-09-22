import {readFileSync,writeFileSync} from 'node:fs';
const files={
  './Utils/decode-wa-message.js':[
    ['if (recipient && !isJidMetaAI(recipient)) {','if (recipient) { // Agent Squad: retain AI bot destinations in own-device copies'],
    ['msg = msg.deviceSentMessage?.message || msg;',`if (msg.deviceSentMessage?.message) {
                            const inner = msg.deviceSentMessage.message;
                            msg = { ...inner, messageContextInfo: { ...msg.messageContextInfo, ...inner.messageContextInfo } };
                        } // Agent Squad: preserve bot session secrets from own-device copies`],
  ],
  // Session fetches kept only LIDs and mapped phone numbers, silently dropping AI bots (@bot) and
  // unmapped numbers, so their key request asked for nobody and encryption failed. Implement the
  // fallback the library's own comment describes: LID if mapped, otherwise the original address.
  './Socket/messages-send.js':[
    [`            // LID if mapped, otherwise original
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
                ...((await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid)))) || []).map(a => a.lid)
            ];`,`            // LID if mapped, otherwise original (Agent Squad: keep unmapped numbers and other servers such as @bot)
            const isPn = (jid) => !!isPnUser(jid) || !!isHostedPnUser(jid);
            const isLid = (jid) => !!isLidUser(jid) || !!isHostedLidUser(jid);
            const mappedPairs = (await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(isPn))) || [];
            const mappedPns = new Set(mappedPairs.map(a => a.pn));
            const wireJids = [
                ...jidsRequiringFetch.filter(isLid),
                ...mappedPairs.map(a => a.lid),
                ...jidsRequiringFetch.filter(jid => isPn(jid) && !mappedPns.has(jid)),
                ...jidsRequiringFetch.filter(jid => !isPn(jid) && !isLid(jid))
            ];`],
  ],
};
for(const [file,patches] of Object.entries(files)) {
 const path=new URL(file,import.meta.resolve('@whiskeysockets/baileys'));
 let source=readFileSync(path,'utf8');
 for(const [before,after] of patches) {
  if(source.includes(after)) continue;
  if(!source.includes(before)) throw Error(`Baileys changed; review the compatibility patch for ${file} before building.`);
  source=source.replace(before,after);
 }
 writeFileSync(path,source);
}
