# MCP Events agents

MCP Events lets a connected client receive work as an agent in your squad. It uses the [OpenAI MCP Events webhook integration](https://developers.openai.com/plugins/build/mcp-events) and MCP protocol version `2026-07-28`. The draft event contract may change.

## Connect

1. Connect your client to the MCP endpoint shown in **Settings → MCP**, or use your ChatGPT tunnel. Rescan the plugin so it discovers the new tools and event.
2. Open **Add Agents → MCP Events**, enter a name, and copy the setup prompt. You can also start from **Settings → Connectors → MCP Events**.
3. Paste it into an event-capable client. For ChatGPT, use a Work cloud chat or a dot with events enabled. An ordinary chat cannot become a persistent worker just by receiving a prompt.
4. The client calls `register_event_agent`, then subscribes to `agent_squad.task.assigned` with the returned `agent_id`. The client supplies and verifies its HTTPS callback; you do not enter a webhook URL in the Mac app.
5. Wait for **Listening for tasks**. You can then send work from an agent card, another MCP client, or the agent's A2A endpoint.

Registration adds the agent but does not start a subscription. Reuse the setup prompt in the agent's configuration to reconnect with the same registration ID. The edit panel includes **Copy Setup Prompt**. Registration retries preserve the existing agent's name and enabled setting.

## Task lifecycle

The event contains `agent_id`, `task_id`, and `session_id`. The receiving agent calls `get_assigned_task` to read the request, conversation, deadline, and current status. It calls `complete_assigned_task` with a text answer and one of `completed`, `failed`, or `input-required`.

A clarification creates an answer in the original conversation. Sending the clarification response assigns a new task ID in that same session. Repeated completion with identical text and status is safe; a different result or an answer after cancellation is rejected. Clients should deduplicate task IDs before taking external actions. Cancellation cannot undo actions already performed by the worker.

Tasks use the agent's timeout (one hour by default for MCP Events). The Mac must remain awake and Agent Squad must remain running. Closing the window leaves it running in the menu bar.

## Delivery and recovery

Subscriptions and assignments are stored locally. Subscriptions expire after at most 24 hours, or earlier if the client requests a shorter TTL; clients must refresh before `refreshBefore`. Webhooks use Standard Webhooks HMAC signatures, verified callbacks, and stable event IDs across bounded retries. Successful receipt means the client accepted the event, not that the task is complete.

This event does not expose cursor replay (`cursor: null`). After subscribing or reconnecting, the worker must call `list_assigned_tasks` to recover outstanding work. Undelivered assignments remain eligible for delivery while active, including after a Mac app restart. Accepted webhooks are not repeatedly sent while the worker processes the task. A client that received an event but lost its own work should recover from the task list.

HTTP 410 ends a subscription. HTTP 413 and other permanent client errors stop retrying that delivery; transient errors and HTTP 429 use exponential backoff, at most eight attempts. Connector status reports delivery failures. If an agent is paused or removed, it stops receiving events. To stop monitoring, the client should unsubscribe; removing an agent also removes its local conversation history.

## Trust and storage

The existing no-authentication MCP model is unchanged: the tunnel or trusted private network grants access to the whole local squad. Agent IDs and registration IDs are routing identifiers, not credentials. All clients with this access can register agents, read assignments, and submit answers; this is not a multi-tenant server. Do not expose it publicly.

Webhook signing secrets are supplied by clients and stored with subscriptions in `mcp-events.json` (mode 0600) inside Agent Squad's protected application support directory. They are never included in UI state or tool results. They authenticate outbound event delivery and are not MCP access tokens. Callbacks must use public HTTPS endpoints; private addresses, redirects, credentials in URLs, and nonstandard ports are blocked. DNS is checked for every request and the connection is pinned to the validated address.

## Development

Run `npm run test:events` for synthetic HTTP, A2A, persistence, signature, filtering, cancellation, retry, and callback validation tests. These tests use isolated state and do not contact real agents. Live delivery still needs an actual event-capable client to create a subscription.
