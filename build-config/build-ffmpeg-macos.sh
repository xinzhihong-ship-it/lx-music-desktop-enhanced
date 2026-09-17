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
ffmpeg_commit='239f2c733de417201d7ad3b3b8b0d9b63285b2b1'
lame_url='https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz'
lame_sha256='ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e'
case "$arch" in
  arm64) cc='clang -arch arm64'; lame_host='aarch64-apple-darwin' ;;
  x64) cc='clang -arch x86_64'; lame_host='x86_64-apple-darwin' ;;
esac

if [ ! -d "$lame_source" ]; then
  mkdir -p "$lame_source"
  curl --fail --location --retry 2 "$lame_url" -o "$root/build/lame-3.100.tar.gz"
  echo "$lame_sha256  $root/build/lame-3.100.tar.gz" | shasum -a 256 -c -
  tar -xf "$root/build/lame-3.100.tar.gz" -C "$lame_source" --strip-components=1
  (cd "$lame_source" && CC="$cc" ./configure --host="$lame_host" --prefix="$lame" --disable-shared --enable-static && make -j"$(sysctl -n hw.ncpu)" && make install)
fi

if [ ! -d "$source/.git" ]; then
  git clone --depth 1 --branch n8.1.1 https://github.com/FFmpeg/FFmpeg.git "$source"
fi
git -C "$source" fetch --depth 1 origin "$ffmpeg_commit"
git -C "$source" checkout --detach "$ffmpeg_commit"
make -C "$source" distclean || true
# --disable-libxcb / --disable-xlib / --disable-lzma / --disable-bzlib：
# 构建机（CI runner）装了 Homebrew 的 libxcb / libX11 / xz 时，ffmpeg 的 configure 一旦探测到
# 就会按绝对路径链上，产物到没有 Homebrew 的用户机上会 dyld 加载失败。macOS 自带 zlib 等系统库，
# 但上面这几个在用户机上是没有的（lzma 甚至完全没有系统版本），禁用不损失可用功能。
# 只保留显式启用的 libmp3lame（静态，见上面的 lame 构建）。
configure_args=(
  --prefix="$source/out"
  --arch="$arch"
  --cc="$cc"
  --disable-gpl
  --disable-nonfree
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-network
  --disable-libxcb
  --disable-xlib
  --disable-lzma
  --disable-bzlib
  --enable-libmp3lame
  --extra-cflags="-I$lame/include"
  --extra-ldflags="-L$lame/lib"
  --extra-libs='-lmp3lame'
)
(cd "$source" && ./configure "${configure_args[@]}")
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

# 发布产物必须自带全部依赖：只允许链接 /usr/lib 与 /System 下的系统库。
# 一旦链上 Homebrew 等构建机上的第三方库（绝对路径），用户机上就会 dyld 加载失败——
# 这正是 resources/ffmpeg/README.md 里禁止的「只在构建机上能用」的产物，直接判定构建失败。
out_of_system="$(otool -L "$output/ffmpeg" "$output/ffprobe" | grep -E '^[[:space:]]+/' | grep -vE '^[[:space:]]+/(usr/lib|System)/' || true)"
if [ -n "$out_of_system" ]; then
  echo "错误：ffmpeg / ffprobe 链接了系统库之外的动态库，发布产物在普通用户机上无法运行：" >&2
  echo "$out_of_system" >&2
  exit 1
fi
echo "依赖检查通过：ffmpeg / ffprobe 只依赖 /usr/lib 与 /System 下的系统库"

# 产物来源记录：随二进制一起放在资源目录里，供核对 / 复现（licenses/ffmpeg/README.md 的要求）。
# 该文件所在目录被 .gitignore 忽略，只在本地与 CI 构件中存在。
{
  echo "ffmpeg runtime build info"
  echo "release: $(cat "$source/RELEASE" 2>/dev/null || echo unknown)"
  echo "source repository: https://github.com/FFmpeg/FFmpeg"
  echo "source commit: $(git -C "$source" rev-parse HEAD)"
  echo "lame: 3.100 ($lame_url)"
  echo "lame tarball sha256: $lame_sha256"
  echo "target: darwin-$arch"
  echo "built on: $(uname -srm)"
  echo "built at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "configure: ./configure ${configure_args[*]//$root/<repo>}"
  echo "sha256:"
  (cd "$output" && shasum -a 256 ffmpeg ffprobe | sed 's/^/  /')
} > "$output/BUILD-INFO.txt"
echo "已写入 $output/BUILD-INFO.txt"
