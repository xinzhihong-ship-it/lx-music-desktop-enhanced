#!/bin/bash
set -euo pipefail

arch="${1:?usage: build-ffmpeg-macos.sh arm64|x64}"
case "$arch" in arm64|x64) ;; *) exit 2 ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/build"
source="$root/build/ffmpeg-8.1.1-source-$arch"
output="$root/resources/ffmpeg/darwin-$arch"
lame_source="$root/build/lame-3.100-source-$arch"
lame="$root/build/lame-3.100-$arch"
case "$arch" in
  arm64) cc='clang -arch arm64'; lame_host='aarch64-apple-darwin' ;;
  x64) cc='clang -arch x86_64'; lame_host='x86_64-apple-darwin' ;;
esac

if [ ! -d "$lame_source" ]; then
  mkdir -p "$lame_source"
  curl --fail --location --retry 2 'https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz' -o "$root/build/lame-3.100.tar.gz"
  echo 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e  '"$root/build/lame-3.100.tar.gz" | shasum -a 256 -c -
  tar -xf "$root/build/lame-3.100.tar.gz" -C "$lame_source" --strip-components=1
  (cd "$lame_source" && CC="$cc" ./configure --host="$lame_host" --prefix="$lame" --disable-shared --enable-static && make -j"$(sysctl -n hw.ncpu)" && make install)
fi

if [ ! -d "$source/.git" ]; then
  git clone --depth 1 --branch n8.1.1 https://github.com/FFmpeg/FFmpeg.git "$source"
fi
git -C "$source" fetch --depth 1 origin 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
git -C "$source" checkout --detach 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
make -C "$source" distclean || true
(cd "$source" && ./configure --prefix="$source/out" --arch="$arch" --cc="$cc" --disable-gpl --disable-nonfree --disable-debug --disable-doc --disable-ffplay --disable-network --enable-libmp3lame --extra-cflags="-I$lame/include" --extra-ldflags="-L$lame/lib" --extra-libs='-lmp3lame')
make -C "$source" -j"$(sysctl -n hw.ncpu)"
make -C "$source" install
mkdir -p "$output"
for binary in ffmpeg ffprobe; do
  if [ -L "$output/$binary" ]; then unlink "$output/$binary"; fi
done
cp "$source/out/bin/ffmpeg" "$source/out/bin/ffprobe" "$output/"
if [ "$(uname -m)" = "$arch" ]; then
  "$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame
  "$output/ffprobe" -version >/dev/null
fi
file "$output/ffmpeg" | grep -q "$([ "$arch" = arm64 ] && echo arm64 || echo x86_64)"
