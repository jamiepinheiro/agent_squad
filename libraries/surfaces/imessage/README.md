# iMessage surface

`createIMessageSurface({ helper })` registers the messaging transport, address/alias validation, local image policy and private Messages setup commands.

- `src/`: invokes the signed native helper; handles deadlines and cancellation.
- `macos/`: Messages helper, read-only SQLite access, automation, Contacts and business conversations, permission UI, picker and image refresh.

The helper runs within the app's signing/permission identity. Full Disk Access enables reading replies; Messages automation enables sending. The Contacts picker belongs to this surface alone. Group chats, outgoing messages and reactions are excluded from incoming replies.

Run checks from the repository root. See [setup](../../../docs/setup.md) and [the extension guide](../../../docs/adding-a-surface.md).
