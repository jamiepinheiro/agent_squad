#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d /Library/Developer/CommandLineTools ]; then
  export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
fi
export CLANG_MODULE_CACHE_PATH="$PWD/.build/clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$PWD/.build/swift-module-cache"
export SWIFTPM_CACHE_PATH="$PWD/.build/swift-cache"
# Never rebuild the development copy while it is being used.
if /bin/ps -axo comm= 2>/dev/null | /usr/bin/grep -Fqx "$PWD/dist/Agent Squad.app/Contents/MacOS/AgentSquad"; then
  echo "Quit the development copy before rebuilding, or run the installed copy from Applications." >&2
  exit 1
fi
npm run build
bash scripts/build-icons.sh
mkdir -p .build/native
sdk="${AGENT_SQUAD_SDK:-$(xcrun --show-sdk-path)}"
# Prefer the installed stable SDK when this machine's default is a preview SDK.
if [ -z "${AGENT_SQUAD_SDK:-}" ] && [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk ]; then
  sdk=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
fi
swiftc -parse-as-library -swift-version 5 -O -whole-module-optimization \
  -target "$(uname -m)-apple-macos14.0" -sdk "$sdk" \
  -module-cache-path "$CLANG_MODULE_CACHE_PATH" -file-prefix-map "$PWD=." \
  macos/Sources/AgentSquad/*.swift libraries/surfaces/*/macos/*.swift -o .build/native/AgentSquad -lsqlite3
app="$PWD/.build/bundle/Agent Squad.app"
# A clean staging bundle prevents old development artifacts surviving a release.
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/runtime" "$app/Contents/Resources/gateway"
cp .build/icons/Assets.car .build/icons/AppIcon.icns .build/icons/AppIconPreview.png .build/icons/SquadMenuTemplate.png "$app/Contents/Resources/"
cp .build/native/AgentSquad "$app/Contents/MacOS/AgentSquad"
if [ "${AGENT_SQUAD_RELEASE:-0}" = "1" ]; then
  runtime="$(python3 scripts/prepare-runtime.py)"
else
  runtime="${AGENT_SQUAD_NODE:-$(command -v node)}"
fi
cp "$runtime" "$app/Contents/Resources/runtime/node"
if [ -f "$(dirname "$runtime")/../LICENSE" ]; then
  cp "$(dirname "$runtime")/../LICENSE" "$app/Contents/Resources/runtime/LICENSE"
elif [ "${AGENT_SQUAD_RELEASE:-0}" = "1" ]; then
  echo "Node runtime license is missing." >&2; exit 1
fi
rsync -a --delete gateway/dist/ "$app/Contents/Resources/gateway/dist/"
cp gateway/package.json "$app/Contents/Resources/gateway/"
# Preserve npm workspace paths so @agent-squad package links resolve inside the bundle.
for library in libraries/kernel libraries/surfaces/*; do
  [ -f "$library/package.json" ] || continue
  mkdir -p "$app/Contents/Resources/$library"
  rsync -a --delete "$library/dist/" "$app/Contents/Resources/$library/dist/"
  cp "$library/package.json" "$app/Contents/Resources/$library/"
done
cp package.json package-lock.json "$app/Contents/Resources/"
# Production dependencies are copied from the lockfile installation; no network at app launch.
python3 scripts/package-dependencies.py "$app/Contents/Resources"
if [ -f LICENSE ]; then cp LICENSE "$app/Contents/Resources/LICENSE"; fi
if [ -n "${AGENT_SQUAD_SOURCE_REVISION:-}" ]; then
  python3 - "$app/Contents/Resources/BUILD-INFO.json" <<'PYINFO'
import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'revision': os.environ['AGENT_SQUAD_SOURCE_REVISION'],
    'repository': 'https://github.com/jamiepinheiro/agent_squad',
}, indent=2) + '\n')
PYINFO
fi
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>AgentSquad</string>
<key>CFBundleIdentifier</key><string>com.jamiepinheiro.agentsquad</string>
<key>CFBundleName</key><string>Agent Squad</string>
<key>CFBundleDisplayName</key><string>Agent Squad</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIconName</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.3</string>
<key>CFBundleVersion</key><string>4</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppleEventsUsageDescription</key><string>Agent Squad sends tasks to agents you register in Messages.</string>
<key>NSContactsUsageDescription</key><string>Choose contacts to add as agents using their names, phone numbers, or email addresses.</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
python3 scripts/sign-app.py "$app"
mkdir -p dist
# Build artifacts are separate from the installed app. Retain an old artifact
# without an .app extension so Launch Services does not discover duplicate apps.
if [ -d "dist/Agent Squad.app" ]; then
  previous="$PWD/.build/previous-$(date +%s).bundle"
  mv "dist/Agent Squad.app" "$previous"
  # Keep only the two newest. Timestamps have a fixed width, so glob order is oldest first.
  backups=("$PWD"/.build/previous-*.bundle)
  if [ "${#backups[@]}" -gt 2 ]; then rm -rf "${backups[@]:0:${#backups[@]}-2}"; fi
fi
mv "$app" "dist/Agent Squad.app"
echo "Built: $PWD/dist/Agent Squad.app"
