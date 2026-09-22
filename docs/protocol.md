# Protocol and security

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_agents` | Discover IDs, names, adapter types, and enabled status |
| `get_agent_card` | Read the native agent’s own advertised skills; messaging cards explain how to ask directly |
| `create_session` | Create a durable context for an agent |
| `send_prompt` | Send a text task; immediately return the session |
| `get_session` | Poll status, accumulated replies, and errors |
| `resume_session` | Load saved history without replaying a request |
| `list_sessions` | List an agent's saved sessions |
| `cancel` | Cancel a native task or stop waiting for messaging replies |
| `send_message` | A2A 0.3 `message/send`, with `agent_id` routing |
| `get_task` | A2A 0.3 `tasks/get` |
| `cancel_task` | A2A 0.3 `tasks/cancel` |

Agent setup stores a name and connection, with no user-authored skill description. Native discovery fetches `/.well-known/agent-card.json` from the configured endpoint’s origin, and requests an authenticated extended card when supported and a token is saved. Messaging agents can describe their skills when asked through a normal prompt; reading their adapter card never sends a message. Old profile descriptions are ignored and removed when state is next saved.

Every operation after discovery takes `agent_id`. Session tools also take `session_id`; task tools use `task_id`. Agent-to-agent protocol task operations preserve the remote response unchanged. Session convenience tools persist a local history and poll native tasks in the background.

## Callers and registered agents

An agent that supports MCP can connect as a client, discover registered agents, and dispatch work to them. Receiving work requires a separate registration through a supported surface; connecting as a client does not automatically create one. Agents with both capabilities can act as callers and recipients.

The ChatGPT tunnel supports the caller role only. ChatGPT can discover registered agents, send tasks, and receive replies, but Agent Squad does not expose ChatGPT as a callable agent. Other agents cannot dispatch work to ChatGPT through this integration.

## Connection and security model

Agent Squad's MCP and A2A endpoints use **no application authentication**: no Agent Squad access tokens, bearer headers, OAuth provider, client registration, or sign-in. Configure MCP clients with **No authentication** and Streamable HTTP. Copy the endpoint from **Settings → MCP**; the default is `http://127.0.0.1:9847/mcp`.

Access is controlled by the transport or private network:

- **ChatGPT tunnel:** OpenAI's tunnel permissions control who can reach the server. The tunnel forwards MCP requests without injecting an Agent Squad authorization header. Choose **No authentication** for the Agent Squad connection. OpenAI still requires its own **tunnel runtime key** to run `tunnel-client`; that key is stored in Keychain and authenticates the tunnel process to OpenAI, not ChatGPT to Agent Squad. See the [official tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
- **Private network, such as Tailscale:** use a tailnet-only proxy to the loopback MCP endpoint. Tailnet membership and access rules determine who can use the squad. Forward `/mcp` (and `/a2a/` if needed), keeping app management paths private. Configure the proxy's upstream Host as `127.0.0.1:9847`, or set `AGENT_SQUAD_TRUSTED_HOSTS` to its exact hostname(s), comma-separated, in the gateway's launch environment. This allowlist only controls Host validation; network access rules provide authorization. Keep the endpoint off the public internet, including Tailscale Funnel.

The gateway continues to bind only to `127.0.0.1`, rejects browser Origin headers, and validates Host headers. Anyone who can reach an allowed MCP/A2A endpoint can discover agents, read task history, and invoke them; access is intentionally granted at the tunnel/network boundary.

The native app's private `/api` management channel retains an internal control secret to protect configuration and process control. It is never entered by the user, exposed in the UI, or supplied to MCP clients. Optional credentials for a downstream native A2A agent are that agent's own requirements. Old `mcp-token` files from earlier builds are unused; no MCP token is created, read, or returned by current builds.

Agent endpoints are exposed at `/a2a/<agent_id>`, with discovery cards at `/a2a/<agent_id>/.well-known/agent-card.json`, under the same network trust model.

## Task semantics and limits

Messaging turns gather new replies until the configurable silence interval expires. The response deadline defaults to 180 seconds. No reply means a failed task with a timeout, rather than a fabricated successful answer. Different protocol sessions share the same underlying personal conversation, so only one turn per messaging agent runs at a time. Human messages and delayed replies can still make conversation correlation ambiguous; silence is a heuristic, not a remote completion signal.

Cancellation stops local waiting for messaging agents; it cannot recall a message or stop the remote agent. Interrupted work is marked on restart and is never automatically resent. A2A cancellation forwards to the remote endpoint. Replies received after an interrupted messaging turn are not imported automatically.

Prompts are **text only**. Profile-image replies are supported as a limited exception. Attachments, streamed A2A responses, push notifications, and ACP subprocess agents are not implemented or advertised. Native agents that require interactive auth or approval return `input-required`; there is no generic permissions UI yet. Agent availability means the profile is enabled; it is not a continuous endpoint health guarantee.

Live end-to-end delivery requires your real accounts, macOS permissions, and chosen agent. Automated tests use isolated transports and local fake A2A endpoints and never send iMessage or WhatsApp messages.
