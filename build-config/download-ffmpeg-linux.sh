#!/bin/bash
set -euo pipefail

arch="${1:?usage: download-ffmpeg-linux.sh x64|arm64}"
source_release='latest'
case "$arch" in
  x64) file='ffmpeg-n8.1-latest-linux64-lgpl-8.1.tar.xz' ;;
  arm64) file='ffmpeg-n8.1-latest-linuxarm64-lgpl-8.1.tar.xz' ;;
  *) exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/build"
archive="$root/build/$file"
checksums="$root/build/ffmpeg-checksums.sha256"
extract="$root/build/ffmpeg-linux-$arch"
output="$root/resources/ffmpeg/linux-$arch"
base_url="https://github.com/BtbN/FFmpeg-Builds/releases/download/$source_release"
curl --fail --location --retry 2 "$base_url/checksums.sha256" -o "$checksums"
curl --fail --location --retry 2 "$base_url/$file" -o "$archive"
(cd "$root/build" && grep "  $file$" "$checksums" | sha256sum -c -)
mkdir -p "$extract" "$output"
tar -xf "$archive" -C "$extract"
ffmpeg="$(find "$extract" -type f -name ffmpeg -perm -u+x | head -1)"
ffprobe="$(find "$extract" -type f -name ffprobe -perm -u+x | head -1)"
test -n "$ffmpeg" && test -n "$ffprobe"
cp "$ffmpeg" "$ffprobe" "$output/"
if [ "$arch" = x64 ]; then "$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame; fi
