#!/bin/bash
set -euo pipefail

arch="${1:?usage: download-ffmpeg-linux.sh x64|arm64}"
source_release='autobuild-2026-08-05-15-18'
case "$arch" in
  x64) file='ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-lgpl-8.1.tar.xz'; sha='6c6d574d71ad13c747b8fee123ec07433b7bfaaad5edef9060016bc65096e440' ;;
  arm64) file='ffmpeg-n8.1.2-34-g9b6c8969e0-linuxarm64-lgpl-8.1.tar.xz'; sha='f4bd74a9126cdbdd17a973904f02b63ab0acdeae00abb09e2d9225fd3319be72' ;;
  *) exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/build"
archive="$root/build/$file"
extract="$root/build/ffmpeg-linux-$arch"
output="$root/resources/ffmpeg/linux-$arch"
curl --fail --location --retry 2 "https://github.com/BtbN/FFmpeg-Builds/releases/download/$source_release/$file" -o "$archive"
echo "$sha  $archive" | sha256sum -c -
mkdir -p "$extract" "$output"
tar -xf "$archive" -C "$extract"
ffmpeg="$(find "$extract" -type f -name ffmpeg -perm -u+x | head -1)"
ffprobe="$(find "$extract" -type f -name ffprobe -perm -u+x | head -1)"
test -n "$ffmpeg" && test -n "$ffprobe"
cp "$ffmpeg" "$ffprobe" "$output/"
if [ "$arch" = x64 ]; then "$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame; fi
