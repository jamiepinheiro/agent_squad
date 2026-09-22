# Release verification

`npm run check` type-checks and builds all workspace packages. Local test suites and diagnostic scripts are intentionally excluded from the public repository.

Before publishing a binary:

1. Build from a clean source checkout and the committed lockfile.
2. Verify the gateway starts with a new temporary data directory and has no saved accounts or agents.
3. Inspect the bundle: production dependencies only, preserved third-party licenses, no credentials, developer paths, test fixtures, or account data.
4. Verify Developer ID signatures, hardened runtime, secure timestamps, and Apple notarization for the app and DMG.
5. Mount the DMG and verify its app and Applications shortcut. Check the installed copy opens and its gateway starts.
6. Include a SHA-256 checksum with the release and verify the downloaded GitHub asset matches it.

Live messaging is separate from release checks and requires an explicitly chosen account and recipient. Isolated verification must not use the developer's saved accounts.
