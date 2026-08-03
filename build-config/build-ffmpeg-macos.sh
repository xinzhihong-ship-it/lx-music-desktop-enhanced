#!/bin/bash
set -euo pipefail

arch="${1:?usage: build-ffmpeg-macos.sh arm64|x64}"
case "$arch" in arm64|x64) ;; *) exit 2 ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/build"
source="$root/build/ffmpeg-8.1.1-source-$arch"
output="$root/resources/ffmpeg/darwin-$arch"
lame="$(brew --prefix lame)"

if [ ! -d "$source/.git" ]; then
  git clone --depth 1 --branch n8.1.1 https://github.com/FFmpeg/FFmpeg.git "$source"
fi
git -C "$source" fetch --depth 1 origin 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
git -C "$source" checkout --detach 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
make -C "$source" distclean || true
(cd "$source" && ./configure --prefix="$source/out" --arch="$arch" --disable-gpl --disable-nonfree --disable-debug --disable-doc --disable-ffplay --disable-network --enable-libmp3lame --extra-cflags="-I$lame/include" --extra-ldflags="-L$lame/lib" --extra-libs="$lame/lib/libmp3lame.a")
make -C "$source" -j"$(sysctl -n hw.ncpu)"
make -C "$source" install
mkdir -p "$output"
for binary in ffmpeg ffprobe; do
  if [ -L "$output/$binary" ]; then unlink "$output/$binary"; fi
done
cp "$source/out/bin/ffmpeg" "$source/out/bin/ffprobe" "$lame/lib/libmp3lame.0.dylib" "$output/"
for binary in "$output/ffmpeg" "$output/ffprobe"; do
  if otool -L "$binary" | grep -q "$lame/lib/libmp3lame.0.dylib"; then
    install_name_tool -change "$lame/lib/libmp3lame.0.dylib" '@executable_path/libmp3lame.0.dylib' "$binary"
  fi
done
"$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame
"$output/ffprobe" -version >/dev/null
