# Adding a surface

A surface is a library that implements the kernel's connection contract. The kernel owns durable tasks; your library owns how a service represents and transports them.

Start with [the echo example](../examples/echo-surface/index.ts). It is a complete messaging surface, with no network dependency.

## 1. Create a library

Use this layout:

```text
libraries/surfaces/your-service/
  package.json
  tsconfig.json
  src/index.ts             Factory returning a Surface
  src/transport.ts         Service client / message conversion
  macos/                   Optional desktop integration
  scripts/                 Optional service-specific tools
```

Copy the manifest and TypeScript configuration from an existing surface. Change the package name to `@agent-squad/surface-your-service`, keep its dependency on `@agent-squad/kernel`, and declare its service dependencies locally. Keep workspace packages `private` until you deliberately choose to publish them.

Add the workspace path to root `package.json` and a project reference to root `tsconfig.json`. Add its dependency and project reference to `gateway/package.json` and `gateway/tsconfig.json`. Run `npm install` to update the lockfile and workspace links.

## 2. Implement the contract

Import `Surface`, `MessagingSurface`, or `TaskSurface` from `@agent-squad/kernel`. The full contract is [surface.ts](../libraries/kernel/src/surface.ts).

Every surface defines:

- `id`: stable persisted identifier, matching agents' `adapterType`.
- `validate(agent)`: synchronous validation of service-owned addresses and options. Return the validated agent; throw a useful error for invalid configuration. The common `AgentSchema` accepts new surface IDs and preserves additional options.
- `conversationKeys(agent)`: canonical destination identities that cannot be registered twice. Return aliases too when multiple addresses share one conversation. Return an empty list when agents have independent remote contexts.
- `profilePhotoSource`: `local` for Contacts or another local source, or `reply` to use the shared image-request flow.

Keep new configuration under a service-owned field such as `connection`. Existing surfaces retain their legacy flat fields for saved-state compatibility. Never persist credentials in that field; use the injected secret reader or the host's credential store.

### Messaging surfaces

Implement `kind: 'messaging'` and a `MessagingTransport`:

| Operation | Contract |
| --- | --- |
| `baseline(agent, signal)` | Return a cursor representing everything already received before this turn |
| `send(agent, text, signal)` | Send once, to the configured destination; reject errors and do not blindly retry ambiguous delivery |
| `receive(agent, cursor, signal)` | Return newer incoming replies for this conversation, with stable IDs and the next cursor |

Exclude historical sync, outgoing messages and unrelated conversations from new replies. Respect cancellation and timeouts. Do not silently skip unread replies when advancing a cursor. Persist any provider-specific pairing or message secrets privately within the surface's data directory.

The kernel serializes turns for each messaging agent, polls replies, ignores duplicate IDs, applies the configured deadline and quiet interval, and persists outcomes. Cancellation stops waiting; it cannot undo a message already sent.

### Task surfaces

Implement `kind: 'task'` and `tasks.send/get/cancel`. Return a normalized `TurnUpdate` containing the local status, remote ID, context ID and display messages. A working task must include a remote ID for polling. Cancellation must return `canceled` only after the provider confirms it.

Protocol translation, rich response parsing and artifacts belong in your library. `raw` is an opaque payload kept for inspection. Use `normalizeSession` for service-specific display normalization and `photoCandidates` for provider-specific image formats. The A2A surface demonstrates these hooks.

## 3. Add setup and lifecycle hooks

Optional hooks include:

- `prepare`: asynchronous validation or discovery before the app saves a profile. It must not send a task.
- `start` / `stop`: initialize and close provider resources. Factories and imports should not connect accounts as a side effect.
- `appState`: expose non-secret connection state for desktop setup.
- `management`: named setup commands available only through the private app API. Use unique names; the registry rejects duplicates. Do not reuse core action names.
- `card` / `rpc`: optional discovery and passthrough for the public A2A facade. Do not expose provider management APIs here.

## 4. Register the library

Import your factory in [gateway/src/surfaces.ts](../gateway/src/surfaces.ts) and add it to `createSurfaces`. Supply its data path, secret reader, or platform helper there. Do not import your implementation into the kernel.

For desktop support, add a `NativeSurface` descriptor and any Swift views/helpers under your library's `macos/` folder, then register it in [NativeSurfaces.swift](../macos/Sources/AgentSquad/NativeSurfaces.swift). Add the native directory to the root `Package.swift` sources. The bundle script discovers surface `macos/*.swift` files automatically.

The descriptor provides picker, settings and editor UI, save preparation, readiness checks, image refresh and optional native helper dispatch. Keep service-specific models and decoding in that folder. Swift sources share the app module and its signing identity; TypeScript libraries are separate workspace packages.

## 5. Verify

```sh
npm run check
npm run app
```

Add tests for validation, cursor behavior, stable message IDs, cancellation, errors, reconnects and stale events. Test remote task states if applicable. Fake service clients and temporary data directories keep these checks independent of personal accounts.

A live message is a separate, deliberate check with an explicitly chosen recipient. Importing a surface, running tests, or validating a connection must not unexpectedly send one.
