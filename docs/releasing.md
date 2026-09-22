# Publishing a macOS release

The initial binary target is Apple Silicon, macOS 14+. Intel users can build from source on an Intel Mac; Intel release binaries are not currently verified.

## Requirements

- Xcode with Icon Composer, accepted Apple SDK license, Node 22+, Python 3, and npm.
- An Apple Developer Program account and a **Developer ID Application** certificate with its private key in Keychain.
- A validated `notarytool` Keychain profile named `agent-squad-notary`. Configure it locally using `xcrun notarytool store-credentials`; never put passwords, API keys, or signing certificates in the repository.
- `AGENT_SQUAD_SIGNING_IDENTITY` set locally to the Developer ID certificate name or fingerprint.

The release uses a pinned official Node runtime and verifies its archive checksum. Dependencies are installed from the lockfile into an isolated production-only bundle. Source builds and the public repository contain no developer account configuration.

## Workflow

```sh
npm ci
npm run check
npm run release -- build
npm run release -- submit-app
# Wait for the printed submission ID to be Accepted by Apple.
npm run release -- package
npm run release -- submit-dmg
# Wait for this submission to be Accepted too.
npm run release -- finish
```

Inspect an existing submission with `xcrun notarytool info SUBMISSION_ID --keychain-profile agent-squad-notary`. Use `notarytool log` for rejection details. The script stores submission IDs locally and avoids duplicate submission of an unchanged artifact. Notarization may take time; do not restart a live submission.

Publish the DMG and `dist/SHA256SUMS` as assets on a versioned GitHub Release only after [verification](verification.md). Users drag the app into Applications. Signing and notarization do not grant Contacts, Full Disk Access, or Messages Automation; each user grants those during setup.

There is no automatic updater in this release. Users can download a newer DMG and replace the app after quitting. Their configuration stays in Application Support and Keychain.
