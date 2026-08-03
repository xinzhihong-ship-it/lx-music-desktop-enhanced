#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$root/build/ffmpeg-armv7"
lame_tar="$work/lame-3.100.tar.gz"
lame_dir="$work/lame-3.100"
ffmpeg_dir="$work/ffmpeg"
output="$root/resources/ffmpeg/linux-armv7l"
mkdir -p "$work" "$output"

curl --fail --location --retry 2 'https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz' -o "$lame_tar"
echo 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e  '"$lame_tar" | sha256sum -c -
tar -xf "$lame_tar" -C "$work"
(cd "$lame_dir" && ./configure --host=arm-linux-gnueabihf --prefix="$work/lame-out" --disable-shared --enable-static && make -j"$(nproc)" && make install)

git clone --depth 1 --branch n8.1.1 https://github.com/FFmpeg/FFmpeg.git "$ffmpeg_dir"
git -C "$ffmpeg_dir" fetch --depth 1 origin 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
git -C "$ffmpeg_dir" checkout --detach 239f2c733de417201d7ad3b3b8b0d9b63285b2b1
(cd "$ffmpeg_dir" && ./configure --prefix="$ffmpeg_dir/out" --arch=arm --target-os=linux --enable-cross-compile --cross-prefix=arm-linux-gnueabihf- --disable-gpl --disable-nonfree --disable-debug --disable-doc --disable-ffplay --disable-network --disable-autodetect --disable-shared --enable-static --enable-libmp3lame --extra-cflags="-I$work/lame-out/include" --extra-ldflags="-L$work/lame-out/lib" --extra-libs='-lmp3lame -lm')
make -C "$ffmpeg_dir" -j"$(nproc)"
make -C "$ffmpeg_dir" install
cp "$ffmpeg_dir/out/bin/ffmpeg" "$ffmpeg_dir/out/bin/ffprobe" "$output/"
file "$output/ffmpeg" | grep -q ARM
qemu-arm-static -L /usr/arm-linux-gnueabihf "$output/ffmpeg" -hide_banner -encoders | grep -q libmp3lame
qemu-arm-static -L /usr/arm-linux-gnueabihf "$output/ffprobe" -version >/dev/null
