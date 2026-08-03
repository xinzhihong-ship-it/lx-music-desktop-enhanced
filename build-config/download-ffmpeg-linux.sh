#!/bin/bash
set -euo pipefail

arch="${1:?usage: download-ffmpeg-linux.sh x64|arm64}"
case "$arch" in
  x64) file='ffmpeg-n8.1-latest-linux64-lgpl-8.1.tar.xz'; sha='4d74265b17fb6675c67fdfc2016f2fc26de084a5269a0e2757f4554120657e5d' ;;
  arm64) file='ffmpeg-n8.1-latest-linuxarm64-lgpl-8.1.tar.xz'; sha='b77233223f7a12b7703f4d49ea91db2df8bd56b9d4fc6d6f9a274b30f15c9151' ;;
  *) exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
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
