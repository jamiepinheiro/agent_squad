# WhatsApp surface

`createWhatsAppSurface({ directory })` registers a Baileys linked-device transport, conversation validation, connection lifecycle, recent chats and private setup commands.

- `src/whatsapp.ts`: pairing, connection generations, cursor-based reply delivery and lifecycle.
- `src/whatsapp-chats.ts`: conversation names, identities and phone-number mappings; no message previews.
- `src/whatsapp-bots.ts`: bot addressing, Muse's encrypted envelope, session keys, rich-text replies and final edits.
- `src/whatsapp-pairing.ts`: optional, read-only recovery of a bot message key from the matching outgoing message in WhatsApp for Mac.
- `macos/`: QR/settings UI, recent-conversation picker and state decoding.
- `scripts/patch-baileys.mjs`: pinned compatibility patch, applied at install/build and rejected if the dependency changes incompatibly.

Baileys uses an unofficial interface. Existing AI conversations may need an original message-encryption key that the phone has not supplied. When WhatsApp for Mac has that conversation, the surface can recover the key from the exact outgoing message referenced by the bot reply. Recovered keys are cached only after authenticating that reply. The linking credential in a welcome request is a different secret and is never used as the message key. If neither device sync nor the local WhatsApp database supplies the key, setup reports it explicitly; history replay is not guaranteed. Unlinking deletes local pairing and cached secrets.

See the **[complete WhatsApp guide](../../../docs/whatsapp.md)** for setup, the Muse wire format and key derivation, native key recovery, storage/security, troubleshooting, and verification. See also [setup](../../../docs/setup.md) and [the extension guide](../../../docs/adding-a-surface.md).
