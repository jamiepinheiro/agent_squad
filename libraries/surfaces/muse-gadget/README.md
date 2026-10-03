# Muse Gadget surface

Raspberry Pi pairing import and an encrypted Muse device connection on macOS.
See [setup and limitations](../../../docs/muse-gadget.md).

- `macos/`: SwiftUI setup for encrypted Pi-to-Mac pairing transfer.
- `scripts/export-pairing.py`: owner-only portable export from a stopped Linux SDK.
- `src/import.ts`: strict portable pairing validation.
- `src/pairing.ts`: imported device identity and shared transport cryptography.
- `src/transfer.ts`: temporary pinned-HTTPS receiver and Pi command.
- `src/noise.ts` and `src/link.ts`: Noise XX, service frames, and the Muse connection.
- `src/native.ts`: Keychain persistence, credential refresh, side chats, and reply callbacks.
- `src/index.ts`: private management actions and the kernel task surface.

The old Linux HTTP bridge is superseded. Import a Pi pairing in Agent Squad before saving
an agent. Mac Bluetooth pairing is removed; use the local-network Pi transfer. Only `agent_squad.reply` is advertised to Muse.

Run `npm run check` and `npm run test:muse-gadget`. The desktop build is `npm run app`.
See `NOTICE` and `LICENSE-MUSE-SDK` for protocol attribution.
