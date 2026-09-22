# Publishing a macOS release

The initial binary target is Apple Silicon, macOS 14+. Intel users can build from source on an Intel Mac; Intel release binaries are not currently verified.

## Requirements

- Xcode with Icon Composer, accepted Apple SDK license, Node 22+, Python 3, and npm.
- An Apple Developer Program account and a **Developer ID Application** certificate with its private key in Keychain.
- A validated `notarytool` Keychain profile named `agent-squad-notary`. Configure it locally using `xcrun notarytool store-credentials`; never put passwords, API keys, or signing certificates in the repository.
- `AGENT_SQUAD_SIGNING_IDENTITY` set locally to the Developer ID certificate name or fingerprint.

The release uses a pinned official Node runtime and verifies its archive checksum. Dependencies are installed from the lockfile into an isolated production-only bundle. Source builds and the public repository contain no developer account configuration.

Commit the audited source before building. The release build embeds its Git revision, mirrors the installed dependencies’ published source archives and pinned upstream sources, and creates a source archive from committed files. Local verification scripts and account data never enter that source checkout. Upstream source archives retain their original contents and licenses. Review `SOURCE-MANIFEST.json` in the source archive for dependency-source coverage before publishing.

## DMG workflow

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

Publish the DMG, corresponding source archive, `dist/RELEASE-MANIFEST.json`, and `dist/SHA256SUMS` as assets on a versioned GitHub Release only after [verification](verification.md) and [distribution licensing](distribution-licensing.md). Users drag the app into Applications. Signing and notarization do not grant Contacts, Full Disk Access, or Messages Automation; each user grants those during setup.

There is no automatic updater in this release. Users can download a newer DMG and replace the app after quitting. Their configuration stays in Application Support and Keychain.

## ZIP workflow with Xcode

A ZIP containing the notarized app is another supported download format. This is useful when the release machine is already signed in to the developer account in Xcode. Xcode can upload and export the app using that account; the command-line `notarytool` profile above is only needed for the DMG workflow.

Start with the same audited release build and corresponding source archive. Put the signed app in an Xcode archive, then upload that archive for Developer ID distribution with Xcode Organizer or `xcodebuild -exportArchive` using an export-options plist with `method=developer-id` and `destination=upload`. Keep the archive and its submission status until Apple finishes processing it.

Once approved, use **Export Notarized App** in Organizer or:

```sh
xcodebuild -exportNotarizedApp \
  -archivePath "Agent Squad.xcarchive" \
  -exportPath notarized-export
codesign --verify --deep --strict "notarized-export/Agent Squad.app"
xcrun stapler staple "notarized-export/Agent Squad.app"
xcrun stapler validate "notarized-export/Agent Squad.app"
spctl --assess --type execute --verbose=2 "notarized-export/Agent Squad.app"
ditto -c -k --keepParent --sequesterRsrc \
  "notarized-export/Agent Squad.app" "Agent-Squad-VERSION-arm64.zip"
```

The signature must be timestamped Developer ID with hardened runtime, and Gatekeeper must report `Notarized Developer ID`. Confirm that the exported app's `BUILD-INFO.json` revision matches the source archive. Publish the ZIP, matching source archive, release manifest, and checksums together. Download and extract the ZIP to verify its checksum, signature, ticket, and launch before publishing the release.

Users extract the ZIP and move Agent Squad into Applications. For an update, quit the existing app before replacing it.
