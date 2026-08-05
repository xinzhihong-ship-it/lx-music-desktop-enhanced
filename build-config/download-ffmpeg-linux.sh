#!/bin/bash
set -euo pipefail

arch="${1:?usage: download-ffmpeg-linux.sh x64|arm64}"
case "$arch" in
  x64) file='ffmpeg-n8.1-latest-linux64-lgpl-8.1.tar.xz'; sha='8e53139130278d516824611b2d608f45a6c62aff0cf7feffa33012349e0061eb' ;;
  arm64) file='ffmpeg-n8.1-latest-linuxarm64-lgpl-8.1.tar.xz'; sha='63fde9a698c0b17acdc5b023860f3f4846b4922599614767d94bdd2b9ade7f80' ;;
  *) exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/build"
archive="$root/build/$file"
extract="$root/build/ffmpeg-linux-$arch"
output="$root/resources/ffmpeg/linux-$arch"
curl --fail --location --retry 2 "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$file" -o "$archive"
echo "$sha  $archive" | sha256sum -c -
mkdir -p "$extract" "$output"
tar -xf "$archive" -C "$extract"
ffmpeg="$(find "$extract" -type f -name ffmpeg -perm -u+x | head -1)"
ffprobe="$(find "$extract" -type f -name ffprobe -perm -u+x | head -1)"
test -n "$ffmpeg" && test -n "$ffprobe"
cp "$ffmpeg" "$ffprobe" "$output/"
if [ "$arch" = x64 ]; then "$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame; fi
