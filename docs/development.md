# Development

## Workspace commands

```sh
npm ci                 # Installs and links the npm workspace packages
npm run build          # Applies the WhatsApp compatibility patch, builds libraries and gateway
npm run check          # Type-check and build every workspace
npm run app            # Build and sign the macOS bundle
npm run app:install    # Install a verified bundle; quit the app first
```

TypeScript project references enforce build order: kernel, surface libraries, then the gateway. `scripts/build.mjs` removes generated outputs before compiling so moved modules cannot remain in a release bundle. The gateway's only concrete surface imports are in `gateway/src/surfaces.ts`.

The root `Package.swift` opens the native sources in Xcode. Native source files from each surface's `macos/` folder compile alongside the shared app shell. They are source integrations in one executable, not dynamically loaded Swift plug-ins. To produce a runnable app with its gateway, runtime and assets, use `npm run app`.

## Local storage and development

State lives under `~/Library/Application Support/Agent Squad/`, with a private directory and atomic JSON snapshots. It contains agent profiles and conversation history. API keys and A2A bearer tokens are stored in macOS Keychain. Baileys linked-device credentials live in the private `whatsapp` subdirectory. Unlink WhatsApp from Settings → Connectors to delete its local credentials.

The Swift app supervises the bundled gateway. The gateway exits when its parent pipe closes, stops the tunnel, and records interrupted turns. The app remains running when its window is closed. Explicit Quit stops both services.

```sh
npm run build         # type-check and compile gateway
npm run check         # type-check and compile all workspaces
npm run app           # build the macOS development bundle
```

For standalone gateway development, `npm run dev` works with the default private data directory. Set `AGENT_SQUAD_DATA_DIR` to an isolated directory when testing. `AGENT_SQUAD_PORT=0` requests a temporary port. The gateway prints a JSON port handshake on startup. Standalone control credentials are written to `control-token`; they should never be supplied to MCP clients. iMessage requires `AGENT_SQUAD_HELPER` to point at the app executable. Local verification can set `AGENT_SQUAD_MESSAGES_DB` to a synthetic database for the read helper.

See [architecture](architecture.md) and [verification](verification.md).

## Signing and packaging

`npm run app` uses an existing Apple Development or Developer ID signing identity, pinned locally in `.build/signing-identity` so subsequent builds retain the same identity. It requires Keychain access. Set `AGENT_SQUAD_SIGNING_IDENTITY` to select a specific identity. The build fails rather than silently switching to ad-hoc signing. `AGENT_SQUAD_ADHOC=1` is available only for disposable development builds; the installer rejects those builds. For distribution outside your Mac, use a Developer ID, hardened-runtime entitlements, and notarization.

`npm run app:install` verifies and installs the signed build into `/Applications/Agent Squad.app`. Quit the app first; the installer refuses to replace a running copy. Updates retain a stable installation path and migrate an existing launch-at-login registration. Your agents and history remain in Application Support. Build artifacts are separate from the installed copy. The source can also be opened as the Swift package at the repository root.


The packaging script includes each workspace's compiled output and package manifest, preserving npm workspace links inside the app bundle. It does not package tests, native source, account data, or research files. The lockfile pins JavaScript dependencies.

## macOS permission identity

Privacy permissions depend on code-signing identity, not just the displayed app name. Early builds used an ad-hoc signature with a per-build code hash and ran from `dist`; rebuilding could invalidate the identity macOS had remembered. Installed builds now use a pinned Apple certificate and a stable Applications location. Switching from the old ad-hoc build to the Apple-signed build can require granting access once to the new identity. macOS provides no public API that lets an app grant itself Full Disk Access.

The setup check runs directly in the native app process and only opens/closes the Messages database. It does not read conversation content, modify the privacy database, or change permissions. The setup window rechecks when it becomes active.

## Application identity

The macOS bundle ID is `com.jamiepinheiro.agentsquad`, the bundled Node signing identifier is `com.jamiepinheiro.agentsquad.runtime.node`, and Keychain credentials use `com.jamiepinheiro.agentsquad.credentials`. The installer accepts the original `com.agentsquad.app` bundle for migration and unregisters its login item before replacement. The app imports the prior launch-at-login preference and copies credentials from the old Keychain service when first read. Agents, sessions, and WhatsApp pairing remain in the existing Application Support directory. macOS privacy permissions belong to the app identity, so Full Disk Access, Contacts, and Messages Automation may need to be granted again after this one-time identity change. Keychain may also ask to allow access to existing credentials.


## Icon assets

The editable layered source is `macos/AppIcon.icon`, created in Apple Icon Composer. It contains three robot silhouettes on a forest-green background. `scripts/build-icons.sh` compiles it into `Assets.car` for modern macOS and `AppIcon.icns` for earlier releases, then exports the in-app preview. The build sets both `CFBundleIconName` and `CFBundleIconFile`. The menu bar uses a matching monochrome template; the Agents navigation symbol remains separate.

Icon builds require Xcode with Icon Composer at `/Applications/Xcode.app`; set `AGENT_SQUAD_XCODE` for another location. Rebuild with `npm run app` after editing the icon source. Vector originals are in `macos/IconArtwork`.


## Before publishing

Package names are private workspaces and are not published to npm. Account state, local credentials, diagnostics, build output, and research captures are local artifacts, excluded by `.gitignore`; they are not source contributions.

See [release packaging](releasing.md) for the Developer ID and notarization workflow.
