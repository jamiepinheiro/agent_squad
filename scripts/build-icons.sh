#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcode="${AGENT_SQUAD_XCODE:-/Applications/Xcode.app}"
actool="$xcode/Contents/Developer/usr/bin/actool"
renderer="$xcode/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
mkdir -p .build/icons
"$actool" macos/AppIcon.icon --compile .build/icons --output-format human-readable-text \
  --app-icon AppIcon --platform macosx --target-device mac --minimum-deployment-target 14.0 \
  --output-partial-info-plist .build/icons/Info.plist
"$renderer" macos/AppIcon.icon --export-image --output-file .build/icons/AppIconPreview.png \
  --platform macOS --rendition Default --width 512 --height 512 --scale 2 --design-generation 26
# The checked-in monochrome template needs no image-processing dependency.
cp macos/Resources/SquadMenuTemplate.png .build/icons/SquadMenuTemplate.png
