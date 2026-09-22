#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcode="${AGENT_SQUAD_XCODE:-/Applications/Xcode.app}"
actool="$xcode/Contents/Developer/usr/bin/actool"
renderer="$xcode/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
# Absolute paths: actool compiles in a shared helper process that resolves relative paths
# against its own directory, so another checkout's build would write icons elsewhere.
icons="$PWD/.build/icons"
mkdir -p "$icons"
"$actool" "$PWD/macos/AppIcon.icon" --compile "$icons" --output-format human-readable-text \
  --app-icon AppIcon --platform macosx --target-device mac --minimum-deployment-target 14.0 \
  --output-partial-info-plist "$icons/Info.plist"
"$renderer" "$PWD/macos/AppIcon.icon" --export-image --output-file "$icons/AppIconPreview.png" \
  --platform macOS --rendition Default --width 512 --height 512 --scale 2 --design-generation 26
# The checked-in monochrome template needs no image-processing dependency.
cp macos/Resources/SquadMenuTemplate.png .build/icons/SquadMenuTemplate.png
