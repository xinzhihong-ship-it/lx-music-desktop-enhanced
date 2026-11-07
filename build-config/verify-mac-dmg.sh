#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: bash build-config/verify-mac-dmg.sh image.dmg" >&2
  exit 2
fi

image_path="$1"
mount_path=$(mktemp -d "${TMPDIR:-/tmp}/lx-dmg-verify.XXXXXX")
mounted=false
cleanup() {
  if [ "$mounted" = true ]; then hdiutil detach "$mount_path" >/dev/null; fi
  rmdir "$mount_path"
}
trap cleanup EXIT

hdiutil verify "$image_path"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_path" "$image_path"
mounted=true
app_path="$mount_path/lx-music-desktop.app"
test -d "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist"
echo "Verified mounted macOS application signature: $image_path"
