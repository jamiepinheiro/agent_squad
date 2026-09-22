# Setup and behavior

## First use

1. Choose **Agents → Add → iMessage**, then allow Contacts access in macOS. For iMessage, search and check off contacts, then select **Add Selected**. WhatsApp uses its own recent conversations, loaded from the linked device and updated automatically; it does not use Mac Contacts. Choose the number or email when a contact has several. Existing conversations are marked **Already added**. Only selected iMessage names and destinations are saved; adding an iMessage contact sends no message. **Agent-to-agent protocol** is a third tab with its endpoint form and connection check. The iMessage tab also has a direct number or Apple ID field with an optional name, usable without Contacts access.
2. Open **Settings → Connectors → Set Up iMessage**. The app checks access itself and guides you into macOS Full Disk Access settings, with a draggable Agent Squad tile. Enable the installed copy in Applications; macOS still requires you to grant this permission. Return to the app to recheck. If macOS asks, quit and reopen. Setup also requests permission to control Messages, so both permissions can be granted before sending your first task. This permission request does not send a message.
3. For WhatsApp, choose **Settings → Connectors → Connect WhatsApp**, then scan the QR code using WhatsApp's Linked Devices screen. Baileys uses an unofficial linked-device interface; compatibility can change with WhatsApp releases.
4. In **Settings → ChatGPT Tunnel**, open OpenAI Platform tunnel settings, create/select a tunnel, and provide its ID plus a runtime API key with **Tunnels Read + Use**. Choose the installed `tunnel-client` executable and select **Save & Connect**.
5. Once the tunnel is connected, open ChatGPT's developer-mode app setup, choose **Tunnel**, select it, and use **No authentication**. Agent Squad does not require an MCP access token or an OAuth flow. Account/workspace eligibility and permissions are controlled by OpenAI.
6. Ask your assistant to discover agents and delegate a task. Or open an agent in the app, type a task, and press **Return** or choose **Send Task**. **Shift–Return** inserts a new line.

OpenAI's current setup uses a Platform tunnel and runtime key; the app does not invent a ChatGPT OAuth sign-in flow. The actual account setup remains in OpenAI's web UI. See the [official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Managing connector access

In **Settings → Connectors**, iMessage shows **Set Up iMessage** when either permission is missing. Once enabled, **Manage Access…** opens macOS Full Disk Access, where you can turn off Agent Squad. **Sending Permissions…** opens Automation, where you can turn off Messages under Agent Squad. Setup requests Messages control alongside the reply-access instructions. These are separate permissions, and Check Access checks both without displaying a permission prompt. macOS may require quitting and reopening after a permission change. Returning to Settings refreshes both permission statuses, and **Check Access** always displays a result.

WhatsApp shows connection or disconnection actions according to its state. **Disconnect** retains pairing for reconnecting; **Unlink this Mac…** asks for confirmation before removing the saved pairing. ChatGPT offers **Disconnect** only while the tunnel is running, and **Cancel Connection** while it is connecting.

## Agent-to-agent protocol URL validation

The native-agent form offers **Check Connection** and always validates before saving. Agent Squad reads `/.well-known/agent-card.json` from the endpoint’s origin and requires a valid Agent Card advertising A2A 0.3 or 1.0 JSON-RPC at the entered endpoint (including additional JSON-RPC interfaces). An MCP URL is rejected even if its host has an Agent Card. Unsupported versions, missing cards, other transports, and mismatched endpoints produce an actionable error before the agent is saved. A reverse proxy must publish the reachable endpoint in its card. Validation sends no messages or task requests and does not follow redirects. There is no automatic MCP fallback or replay of failed requests.

## WhatsApp connection troubleshooting

Before connecting, Agent Squad retrieves the current WhatsApp Web version from WhatsApp. The dependency’s older bundled version can be rejected with error 405 before producing a QR code. Version-lookup failures and connection rejections are shown in Settings; temporary network retries are limited to three, and a stalled initial handshake times out. Cancel Connection stops pending retries. QR generation alone does not verify phone-side linking or message delivery.


Agent-to-agent protocol 1.0 requests use the selected interface’s version and tenant, PascalCase methods, and the `A2A-Version` header. Replies are normalized into the existing task model. The public Agent Squad A2A facade remains version 0.3.

The WhatsApp picker caches conversation names, addresses, and activity times only. It does not display or store message previews. Groups are excluded. WhatsApp private chat identifiers are supported even when a phone number is unavailable. Unlinking clears this cache. Refresh requests a new WhatsApp app-state snapshot and, once per launch, a replay of recent history notifications. Names and address mappings persist across restarts. History replay depends on the phone supplying it; a cached chat name does not prove its messages are available.

Conversation labels use WhatsApp history display names and phone-number mappings. Unnamed conversations show their distinct WhatsApp IDs, and invalid system addresses are excluded. WhatsApp AI conversations (`@bot`, including Muse) use a dedicated text transport that preserves their bot addresses. Muse prompts are wrapped in an authenticated encrypted envelope using the existing chat pairing key; own-device copies remain readable. The connector decrypts bot replies, reads their rich-text responses, and combines streaming edits into a single final reply. Bot session secrets are stored privately alongside the linked-device state and cleared when you unlink WhatsApp. Existing AI chats may require their original session key from phone history; when one is missing, Agent Squad requests it from the primary device and reports the missing sync. History replay is not guaranteed. The Baileys compatibility patch in `libraries/surfaces/whatsapp/scripts/patch-baileys.mjs` preserves bot destinations and session keys in own-device messages; installation and builds apply it and fail if the dependency changes incompatibly.

iMessage agents selected from Contacts accept replies from the other phone numbers and Apple ID emails on that selected contact. The chosen destination is still used for sending. Editing the destination clears those saved reply aliases. Message helper operations honor cancellation and timeouts even if another process inherits their output handles.

### Agent profile photos

New iMessage agents use their Mac Contacts photo when available. Adding a WhatsApp or native A2A agent sends one profile-picture request, visible as a session in Activity. Agent Squad accepts an image attachment (WhatsApp uses its thumbnail) or a direct HTTPS image URL, and saves the image locally. Images must be PNG, JPEG, GIF, or WebP and at most 512 KB. If no usable image arrives, the agent keeps its standard icon. Existing agents are not messaged automatically, and editing an agent does not repeat the request.

Use **Edit Agent → Image → Refresh Image** to fetch a replacement. iMessage refreshes from Contacts; other agents receive a new image request. An unsuccessful refresh keeps the previous image.

The iMessage picker also includes existing **Messages for Business** conversations, including accounts with `urn:biz:` addresses. These are discovered from Messages rather than Contacts, sent to their existing chat, and use the locally cached business logo when available. **Refresh Image** reloads that logo; open the conversation in Messages first if its branding has not been cached.

