# WhatsApp surface

`createWhatsAppSurface({ directory })` registers a Baileys linked-device transport, conversation validation, connection lifecycle, recent chats and private setup commands.

- `src/whatsapp.ts`: pairing, connection generations, cursor-based reply delivery and lifecycle.
- `src/whatsapp-chats.ts`: conversation names, identities and phone-number mappings; no message previews.
- `src/whatsapp-bots.ts`: bot addressing, Muse's encrypted envelope, session keys, rich-text replies and final edits.
- `macos/`: QR/settings UI, recent-conversation picker and state decoding.
- `scripts/patch-baileys.mjs`: pinned compatibility patch, applied at install/build and rejected if the dependency changes incompatibly.

Baileys uses an unofficial interface. Existing AI conversations may need an original pairing key that the phone has not supplied. Missing-key errors remain explicit; history replay is not guaranteed. Unlinking deletes local pairing and cached secrets.

See [setup](../../../docs/setup.md) and [the extension guide](../../../docs/adding-a-surface.md).
