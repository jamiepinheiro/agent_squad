# WhatsApp

Agent Squad’s WhatsApp surface connects existing chat agents to the kernel’s shared messaging interface. It owns linking, conversation discovery, addressing, encryption, and incoming message decoding. The kernel owns agents, sessions, task waiting, and the public MCP/A2A interfaces.

This guide describes the implementation in this repository, including behavior observed with Muse. The Muse wire format and WhatsApp for Mac database layout are compatibility details of unofficial interfaces, not a published guarantee from WhatsApp. Do not assume every `@bot` agent uses Muse’s envelope.

## Contents

- [Set up and verify](#set-up-and-verify)
- [Conversation discovery](#conversation-discovery)
- [The three kinds of keys](#the-three-kinds-of-keys)
- [How Muse messages are encrypted](#how-muse-messages-are-encrypted)
- [Recovering the original message key](#recovering-the-original-message-key)
- [Replies, streaming, and completion](#replies-streaming-and-completion)
- [Storage and security](#storage-and-security)
- [Troubleshooting](#troubleshooting)
- [Implementation map](#implementation-map)
- [Maintaining and verifying the connector](#maintaining-and-verifying-the-connector)

## Set up and verify

1. Have a working conversation with the agent in WhatsApp. For Muse, complete Muse’s own WhatsApp setup first. Linking Agent Squad as a device does not create or replace Muse’s chat pairing.
2. In Agent Squad, open **Settings → Connectors → WhatsApp → Connect**.
3. On your phone, open WhatsApp → **Linked Devices → Link a Device**, then scan the QR code.
4. Open **Agents → Add → WhatsApp**. Refresh the list if needed, select the conversation, and add it. Adding a WhatsApp agent sends a profile-image request, visible in Activity.
5. Send a short test such as “Please reply with connected.” Confirm the answer appears in that Agent Squad session. When diagnosing Muse, about ten seconds is a useful initial reply check; if it does not answer, inspect the failure before sending more tests. This is a diagnostic check, not the app’s configured task timeout.

There are three separate milestones: the QR code is displayed, WhatsApp reports the device connected, and the agent answers a prompt. Only the last verifies the complete send/decrypt/reply path. A server acknowledgment also does not prove the bot understood the message.

**Disconnect** closes the connection and retains pairing for later use. **Unlink this Mac** signs out and removes the local WhatsApp pairing, conversation cache, and bot secrets. WhatsApp revoking the device link also clears that local state. Neither action recalls messages or deletes conversations on your phone. Saved Agent Squad sessions are separate from the connector’s pairing directory.

## Conversation discovery

The picker uses WhatsApp contacts, chat updates, history notifications, and observed messages. It does not use macOS Contacts. It caches names, addresses, identity mappings, and activity times; it does not save or show message previews in that cache. Task messages are still saved in Agent Squad sessions.

The connector supports phone-number addresses, WhatsApp private identifiers (`@lid`), and AI addresses (`@bot`). It preserves these identities instead of treating every conversation as a phone number. Groups and invalid system addresses are excluded. Unnamed conversations show distinct identifiers; WhatsApp can label a Muse conversation with a generic AI name. Check its identity against your existing conversation before choosing it.

**Refresh** rebuilds the local app-state snapshot while retaining encryption keys. It also requests a replay of up to five previously received history notifications once per transport lifetime, normally once per app launch. Missing app-state keys are requested from the primary phone; arriving key shares are stored and trigger another snapshot sync. Keeping WhatsApp open on your phone may help, but neither names nor complete history are guaranteed to arrive. A visible chat name does not prove that its bot encryption key has synced.

## The three kinds of keys

| Key or credential | Purpose | Source |
| --- | --- | --- |
| Linked-device authentication, Signal sessions, and app-state keys | Connect the Mac, encrypt normal device traffic, and read synchronized chat/contact state | WhatsApp device linking and subsequent synchronization |
| Muse linking credential | Establish Muse’s integration with the conversation | The welcome/linking request |
| Original message secret | Derive keys for Muse’s extra encrypted message envelope | The pairing message’s actual `messageContextInfo.messageSecret`, or that exact message’s local metadata |

**The welcome request’s linking credential is not the message-encryption key.** Both may look like 32-byte secrets. Substituting one for the other creates an envelope that the bot cannot authenticate, even though the device is connected and WhatsApp accepts the outgoing stanza.

Muse replies can refer back to the original pairing message across many turns. Its verified secret must survive restarts and must not be evicted with ordinary recent-prompt secrets. The connector stores roots separately and retains at most 200 non-root prompt secrets.

## How Muse messages are encrypted

Ordinary chats use Baileys’ normal send path. AI destinations use a dedicated bot transport that preserves `@bot` addresses. Muse’s known destination additionally uses `SecretEncryptedMessage` inside the normal Signal transport. Other bot addresses are not automatically given that envelope.

### Outgoing prompt

1. Generate a fresh WhatsApp message ID and a fresh 32-byte per-prompt message secret.
2. Encode a WhatsApp `proto.Message` containing the text, `messageContextInfo.messageSecret`, an available persona ID, and the rich-response capability.
3. Select the saved Muse session root and its original message ID. Normalize the sender to the account’s LID when available, otherwise its phone-number identity. Reject a root belonging to a different sender.
4. Optionally look up that exact original message’s key in WhatsApp for Mac. If available, it takes precedence for constructing this outgoing envelope; otherwise use the cached key.
5. Derive the encryption key, encrypt the encoded message, and wrap it in `SecretEncryptedMessage` referencing the original pairing message.
6. Send the wrapped message to the bot using Baileys’ Signal participant encryption. Send ordinary readable text copies through encrypted sessions to the account’s other devices.

Own-device discovery uses the normalized account identity, not a specific device address. Migrated accounts use LID sessions for these copies. Addressing those devices by an unrelated phone-number session can leave WhatsApp showing “Waiting for this message.” “Readable copies” means the inner message format is ordinary text; transport encryption remains in place.

### Key derivation and authenticated data

The following notation documents the implemented wire format. All string inputs are UTF-8. Each HKDF invocation uses SHA-256, an empty salt, and a 32-byte output.

```text
S = original pairing message’s 32-byte message secret
I = current wire message ID
U = normalized identity of the original prompt sender
B = bot’s complete @bot address

baseKey = HKDF(S, info = "Bot Message")
key     = HKDF(baseKey, info = I || U || B)

outgoing AAD = I || NUL || U
incoming AAD = I || NUL || B
```

Encryption is AES-256-GCM with a fresh 12-byte IV for an outgoing message. `encPayload` contains ciphertext followed by the 16-byte authentication tag; `encIv` carries the IV. Outgoing `targetMessageKey` identifies the bot, sets `fromMe: true`, and references the original pairing message ID. Incoming `msmsg` frames identify their root with `meta.target_id` and may specify `target_sender_jid`.

A streaming edit has its own encryption ID. Derive its key using that actual wire ID, not `edit_target_id`; the latter is for grouping the displayed response. Incoming payloads shorter than the tag or with an invalid IV length are rejected. Authentication must succeed before the decoded message is accepted.

## Recovering the original message key

The normal source is an outgoing message received through device/history sync. The connector searches supported nested wrappers for an actual 32-byte `messageContextInfo.messageSecret`. Quoted messages are excluded because their secrets belong to other messages. A compatibility patch preserves the outer context when Baileys unwraps own-device copies.

If an encrypted reply references an unknown original message, the connector requests that message from the primary phone with its sender identity and requests up to 50 preceding chat messages. It retains a bounded pending queue for replies awaiting a synced secret. Phone history may omit AI conversations or the original key; a refresh is not a guarantee of recovery.

### Optional WhatsApp for Mac fallback

When WhatsApp for Mac has the original outgoing message, `whatsapp-pairing.ts` can read its metadata from:

```text
~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
```

This lookup uses Node 22’s SQLite support and opens the database **read-only**. It selects only the row matching all of:

- the referenced original message ID (`ZSTANZAID`);
- the exact bot address (`ZTOJID`);
- an outgoing message (`ZISFROMME = 1`).

It joins that message to its media metadata, requires exactly one result, and extracts protobuf field **68** from `ZMETADATA`. That field must contain exactly 32 bytes. The bounded parser rejects truncated data, invalid wire lengths, and duplicate secret fields. It does not search other conversations for plausible keys or modify WhatsApp’s database.

On receiving a reply, the connector tries recovery if the key is missing or the cached key fails authentication. **A recovered candidate replaces the saved session root only after successfully authenticating a real reply for that bot and original message.** Constructing an outgoing envelope with a candidate does not establish that it is valid.

WhatsApp for Mac is an optional recovery source, not a requirement for every WhatsApp chat. The database can be absent, inaccessible under macOS permissions, busy, or changed by a WhatsApp update. In those cases the lookup returns no key. Opening the chat and refreshing can make synchronized data available, but cannot manufacture missing history or bypass macOS access controls. Once an authenticated root is cached, it remains available across restarts until unlinking clears it.

## Replies, streaming, and completion

Bot frames are handled directly from the socket because the standard library path does not cover this AI format. The connector supports ordinary Signal-encrypted bot frames and Muse’s `msmsg` envelope. It extracts plain text and supported rich-response markdown, including wrapped/edited messages.

Muse can send a first response, intermediate edits, and a final edit. The connector withholds `first` and `inner` frames, then publishes the final response under a stable display ID. Delivery acknowledgments are sent for decoded progress and final frames without marking them read. This lets WhatsApp advance its queue instead of replaying the same offline frames.

Decoded replies go straight into the surface’s inbox rather than being re-emitted into Baileys’ buffered event stream, where they could remain stuck. Retransmitted notifications are deduplicated by message ID and recipient before receiving a new cursor. Offline/history messages can update discovery and keys but are not treated as fresh task replies.

The kernel captures a cursor before sending and polls for newer replies. After a reply arrives, it waits for the agent’s configured quiet interval before marking the task complete, so “working” can briefly remain visible after text appears. Canceling stops local waiting; it cannot recall a sent message or stop the remote bot. WhatsApp supplies a shared conversation rather than isolated A2A sessions, so a new Agent Squad session does not create a new remote bot chat. Agent Squad does not send an explicit Muse AI thread ID. Reusing the pairing message’s encryption key authenticates messages; it does not establish which AI thread Muse selects or guarantee continuity with the phone’s AI context. The live round-trip checks verify message delivery and replies, not cross-device AI thread continuity.

## Storage and security

Default local files live under:

```text
~/Library/Application Support/Agent Squad/
  state.json                      Registered agents and saved task conversations
  whatsapp/
    creds.json                    Linked-device credentials
    …                             Baileys session and synchronization key files
    bot-message-secrets.json       Prompt secrets and verified bot session roots
    recent-chats.json              Conversation discovery cache; no previews
```

The WhatsApp directory is restricted to the current user (`0700`), and bot-secret files are written with owner-only permissions (`0600`) using a temporary file and rename. These WhatsApp credentials and secrets are **local files, not Keychain entries**. They are sensitive account data and must not be committed, attached to bug reports, or bundled with releases. The repository excludes these runtime files. A custom gateway data directory relocates its WhatsApp state; the optional native database lookup still refers to the current user’s WhatsApp for Mac data.

By default, the Baileys logger is silent. `AGENT_SQUAD_WHATSAPP_LOG` enables diagnostic logging to a specified file. Although our key diagnostics avoid secret values, underlying library debug events can contain contact details and message data. Keep such logs private and outside the WhatsApp pairing directory if they must survive unlinking. Share only redacted, relevant error details.

MCP access is separate from WhatsApp pairing: Agent Squad has no MCP access-token or OAuth flow. The ChatGPT tunnel or a trusted private network controls who can reach it. A client that can use the endpoint can ask the squad to send real messages through the linked account. See [protocol and security](protocol.md).

## Troubleshooting

| Symptom | Meaning and next step |
| --- | --- |
| No QR code, or connection error 405 | The current WhatsApp Web version must be fetched before connecting. Check Settings for the actual error and verify network access. A stale dependency version can be rejected before QR generation. |
| Device was removed / signed out | WhatsApp revoked the link. Connect and scan a new QR code. This is distinct from Muse’s own integration pairing. |
| Connected, but Muse is missing or unnamed | Refresh recent conversations with WhatsApp open on the phone. Check for a generic AI label or a distinct bot ID. Names and history arrive separately; a missing display name does not imply an unsupported bot. |
| AI chat’s session key has not synced | Keep the existing Muse chat available in WhatsApp for Mac and refresh. Recovery needs the exact original message and accessible metadata, or a phone sync that includes its real secret. Repeated unlinking removes useful cached keys and is not a general fix. |
| Authentication error / unsupported message | Check the original message secret, sender LID, bot address, current wire ID, IV, and AAD. Never substitute the welcome linking credential. Normal text delivery to Muse is insufficient. |
| WhatsApp accepts a send, but no answer arrives | A transport ACK is not bot-level success. Check envelope construction and key selection before retrying. Use a short, explicit reply test and inspect after about ten seconds. |
| Phone shows “Waiting for this message” | Check own-device discovery and LID session addressing separately from the bot’s encrypted envelope. |
| Reply arrived, but the task still says working | Allow the configured quiet interval. If it remains stuck, check final-edit decoding and delivery into the surface inbox; a progress frame alone is not a final reply. |
| Repeated or historical answers appear | Check receipt handling, stable edit IDs, duplicate filtering, and live-versus-history classification. Do not replay old history as a new task answer. |

Connection retries are bounded: temporary failures retry up to three times, while explicit rejection codes surface an error. Canceling or disconnecting invalidates the old socket generation so late events cannot restore a stale connection. Reconnecting transport does not automatically resend an interrupted user prompt.

## Implementation map

All WhatsApp-specific logic stays under [`libraries/surfaces/whatsapp`](../libraries/surfaces/whatsapp):

| File | Responsibility |
| --- | --- |
| [`src/index.ts`](../libraries/surfaces/whatsapp/src/index.ts) | Surface registration, destination validation, lifecycle and private management commands |
| [`src/whatsapp.ts`](../libraries/surfaces/whatsapp/src/whatsapp.ts) | QR/link lifecycle, version selection, app-state synchronization, bot socket dispatch and cursor-based inbox |
| [`src/whatsapp-chats.ts`](../libraries/surfaces/whatsapp/src/whatsapp-chats.ts) | Names, addresses, private-ID mappings and recent-conversation cache |
| [`src/whatsapp-bots.ts`](../libraries/surfaces/whatsapp/src/whatsapp-bots.ts) | Bot addressing, Muse encryption, remembered roots, rich-text parsing and final edits |
| [`src/whatsapp-pairing.ts`](../libraries/surfaces/whatsapp/src/whatsapp-pairing.ts) | Bounded metadata parser and read-only recovery from the exact native message |
| [`scripts/patch-baileys.mjs`](../libraries/surfaces/whatsapp/scripts/patch-baileys.mjs) | Compatibility changes to the pinned dependency |
| [`macos/`](../libraries/surfaces/whatsapp/macos) | Native connector controls, QR display and conversation picker |

The surface exposes `baseline`, `send`, and `receive`; no Muse cryptography or WhatsApp database access belongs in the kernel. The transport accepts a runtime dependency for native key recovery so verification can use an isolated database. See [adding a surface](adding-a-surface.md) for the shared contract.

## Maintaining and verifying the connector

Baileys is pinned to `7.0.0-rc14` in the surface package. The compatibility patch is idempotent and fails if the expected source changes rather than silently patching an unknown version. It currently preserves AI destinations and message context in own-device copies, and retains unmapped phone numbers and `@bot` addresses when requesting Signal sessions. Review all three behaviors when upgrading.

The repaired Muse path was verified with a fresh Agent Squad prompt receiving “connected” in about five seconds. After installing and restarting the signed app, another fresh test received the same reply in 6.7 seconds and the session completed. The failures leading to this fix were ordinary-text sends replacing the required envelope and a welcome linking credential being cached as the message key. Captured encrypted replies authenticated with the exact native message secret and the correct sender LID. This confirms the tested conversation and implementation; new accounts still depend on WhatsApp supplying the necessary pairing data.

For future changes:

1. Run `npm run check` for workspace type-checking/builds. This sends no messages and does not prove interoperability.
2. Use synthetic keys and isolated fixtures to verify envelope decryption, tamper/wrong-AAD rejection, sender identity, own-device copies, and the absence of a send when no session root exists.
3. Verify native recovery selects only the exact outgoing bot message, rejects malformed metadata, leaves the database unchanged, and saves a candidate only after authenticated decryption. A wrong candidate must not replace a saved root.
4. Exercise final edits, receipts, duplicate delivery, app-state key recovery, disconnect/reconnect, and persistence after restart. Local test suites and private captures are intentionally excluded from this repository; do not reference account captures as public fixtures.
5. With an explicitly authorized account and recipient, send one short live test. Observe both the fresh reply in Agent Squad and eventual session completion. Inspect after roughly ten seconds if Muse does not answer; do not treat a server ACK, old reply, or separate phone message as success.
6. Verify the signed installed app after restart, since permissions, packaged runtime, and cached keys can differ from a development shell. Keep all account data out of the build and distribution.

For general packaging and release checks, see [development](development.md) and [verification](verification.md).
