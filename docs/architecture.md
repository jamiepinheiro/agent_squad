# Architecture

## Dependency direction

```text
macOS shell                  gateway host
    │                            │
    ├─ NativeSurface UI          ├─ registered surface libraries
    │  descriptors               │     │
    └─ private HTTP API ──────────┴─────┴─ kernel
```

`@agent-squad/kernel` has no dependency on a concrete surface or on the gateway. Each surface library depends on the kernel's exported contract. The gateway is the composition root: it chooses the libraries, supplies storage paths and credential access, then starts the kernel and loopback HTTP listener.

## Kernel

| Module | Responsibility |
| --- | --- |
| `kernel.ts` | Shared app actions, snapshots, startup and shutdown |
| `surface.ts` | Messaging/task interfaces, registration and private setup hooks |
| `types.ts` | Common agent/session schema and opaque surface configuration |
| `router.ts` | Turn ownership, dispatch, polling, timeouts, cancellation and profile requests |
| `store.ts` | Atomic snapshots and interruption recovery |
| `protocol.ts`, `server.ts` | MCP tools, public A2A facade, HTTP transport and access boundaries |
| `profile-photo.ts` | Generic image validation and retrieval |

The router branches on capabilities (`messaging` or `task`), never surface IDs. Messaging transports expose cursors; the kernel captures a cursor before sending, polls new replies, deduplicates IDs and completes after a quiet interval. Task surfaces return a normalized `TurnUpdate`; the kernel persists it and polls until a terminal outcome. Opaque remote payloads are stored without interpreting their service-specific formats.

Common agent fields and the persisted `adapterType` name remain compatible with existing state. Surface options are preserved in the agent envelope; each surface validates its own fields. Unknown surface profiles and history can still be loaded, but starting new work fails until that library is registered. Surface normalization handles legacy reply representations without adding service knowledge to the store.

## Surface libraries

Each folder under `libraries/surfaces/` contains its TypeScript package and optional `macos/` sources and scripts.

- **iMessage:** recipient and alias validation, helper invocation, local health and business-chat commands, Contacts, privacy setup, Apple Events and read-only SQLite access.
- **WhatsApp:** credentials, QR lifecycle, chat identity/name cache, message parsing, bot encryption, receipts, retries, and the Baileys compatibility patch.
- **A2A:** Agent Card validation, downstream credentials, 0.3/1.0 translation, remote task normalization, duplicate artifacts and remote image formats.

Surface private commands use `SurfaceHost` for the limited agent operations they need. They are routed through the authenticated app API, not exported as additional MCP tools. Lifecycle hooks own connection startup/shutdown; no surface background work starts just by importing a library.

## Desktop host

The shared SwiftUI shell renders navigation, the agent editor and conversations. `NativeSurface` provides add-agent UI, connection fields, connector settings, local readiness checks, image refresh, save preparation and helper-command dispatch. Concrete implementations live under their surface's `macos/` directory. `NativeSurfaces.swift` is the only list of built-in desktop integrations.

Native sources compile into one executable so the Messages helper retains the same macOS permission identity as the UI. This is a source extension interface, not runtime plug-in loading. Shared UI accesses connector state through an opaque `surfaceState` envelope; each integration decodes its own fields.

The desktop app starts the gateway as a child process, reads its port handshake and uses a per-launch control secret for private actions. Closing the window leaves the app running; quitting stops the child, surface connections and tunnel. The gateway host owns Keychain access and the optional tunnel process, which are deployment concerns rather than chat surfaces.

## Protocol boundaries

The public A2A facade remains 0.3 JSON-RPC. A surface can supply discovery and an A2A passthrough hook; otherwise the facade adapts local sessions. The native A2A library translates downstream 1.0 endpoints into this public contract. Neither streaming nor push notifications are advertised.

MCP and public A2A use network/tunnel authorization; the private management API has a separate internal secret. See [protocol and security](protocol.md).

## Extending

See [Adding a surface](adding-a-surface.md). The echo example demonstrates the connection contract without using a real account.
