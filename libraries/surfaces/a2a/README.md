# Agent-to-agent protocol surface

This surface connects directly to agents implementing the [Agent-to-Agent (A2A) protocol](https://github.com/a2aproject/A2A). Their Agent Cards advertise their identity, capabilities, skills, and supported endpoints. Agent Squad brings these agents into the shared squad and exposes them to assistants through its MCP server.

`createA2ASurface({ secret })` registers a task surface. It owns Agent Card discovery, endpoint validation, optional downstream credentials, and A2A 0.3/1.0 JSON-RPC translation.

The library translates remote messages, task status, and results into the kernel's common task interface. It preserves remote task and context IDs so follow-up messages and status checks stay attached to the right conversation.

- `src/a2a.ts`: wire client, version and tenant handling.
- `src/index.ts`: connection validation and conversion into kernel `TurnUpdate` values.
- `src/native-replies.ts`: duplicate reply/artifact display normalization.
- `src/photos.ts`: image formats from remote messages and artifacts.
- `macos/`: endpoint editor, connection check and credential-save preparation.

Connection validation reads the Agent Card and never sends a task. The entered URL must be advertised by that card; an MCP endpoint is not accepted as A2A. The kernel's public A2A facade remains 0.3; this library handles downstream version differences.

See [the extension guide](../../../docs/adding-a-surface.md).
