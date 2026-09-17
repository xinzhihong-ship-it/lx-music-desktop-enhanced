# FFmpeg runtime provenance

`resources/ffmpeg/<platform>-<arch>/{ffmpeg,ffprobe}` ship inside every release and power the in-app
audio conversion queue. Each pair must be reproducible from this record, and must run on an end user
machine that has nothing installed (see the dependency rule at the end).

| Target | Version | How it is produced | License |
| --- | --- | --- | --- |
| `darwin-arm64`, `darwin-x64` | FFmpeg n8.1.1 (commit `239f2c733de417201d7ad3b3b8b0d9b63285b2b1`) + LAME 3.100 | built from source by `build-config/build-ffmpeg-macos.sh` | LGPL-2.1-or-later (FFmpeg, built with `--disable-gpl --disable-nonfree`); LGPL-2.0 (LAME, statically linked) |
| `win32-x64`, `win32-x86`, `win32-arm64` | FFmpeg 8.1.2 | downloaded by `build-config/download-ffmpeg-windows.ps1` from System233/ffmpeg-msvc-prebuilt (`ffmpeg-8.1.2_<arch>-windows-static-lgpl.zip`, SHA-256 pinned in the script) | LGPL |
| `linux-x64`, `linux-arm64` | FFmpeg n8.1 (lgpl-8.1 builds) | downloaded by `build-config/download-ffmpeg-linux.sh` from BtbN/FFmpeg-Builds (`ffmpeg-n8.1-latest-linux{64,arm64}-lgpl-8.1.tar.xz`, verified against the release's `checksums.sha256`) | LGPL |
| `linux-armv7l` | pinned in `build-config/build-ffmpeg-linux-armv7.sh` + LAME 3.100 | built from source (cross-compiled with `--disable-autodetect`) | LGPL |

## macOS build record

Produced by `bash build-config/build-ffmpeg-macos.sh <arch>`:

- FFmpeg: tag `n8.1.1`, commit `239f2c733de417201d7ad3b3b8b0d9b63285b2b1` —
  https://github.com/FFmpeg/FFmpeg
- LAME 3.100: https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz —
  SHA-256 `ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`
- configure command (the script also writes a `BUILD-INFO.txt` next to every binary it produces):

  ```
  ./configure --prefix=<out> --arch=<arch> --cc='clang -arch <arch>' \
    --disable-gpl --disable-nonfree --disable-debug --disable-doc --disable-ffplay \
    --disable-network --disable-libxcb --disable-xlib --enable-libmp3lame \
    --extra-cflags="-I<lame>/include" --extra-ldflags="-L<lame>/lib" --extra-libs='-lmp3lame'
  ```

  `--disable-libxcb --disable-xlib` is required on macOS: without it, configure auto-detects the
  build machine's Homebrew `libxcb` / `libX11` and links them by absolute path, and the shipped
  binary then fails to load (dyld) on machines without Homebrew.
- SHA-256 of the current `darwin-arm64` pair (a rebuilt pair with the same recipe is expected to
  reproduce these; CI artifacts are authoritative):

  ```
  8482807d25d37fe8621ebcc90f7cda566b668909a24584bb59c407c81d77e1cd  ffmpeg
  a25c37169808d973b5da55516c79a4d73c4ec9d0c7fccfff9307bc16a292225d  ffprobe
  ```

## Source offer

FFmpeg and LAME are distributed under the GNU LGPL. The complete corresponding source for every
version used in a release is available from the upstream projects linked above — for the
source-built targets at the exact tag/commit listed, for the downloaded targets from the upstream
release pages. Anyone who received a binary build of this application may request the corresponding
source by opening an issue in this repository.

## License notices

- `FFmpeg-COPYING.LGPLv2.1.txt` — FFmpeg's LGPL v2.1 text, taken from the FFmpeg source tree used
  for the macOS builds.
- `lame-COPYING.LGPLv2.txt` — LAME's license (GNU Library General Public License, version 2), taken
  from the LAME 3.100 source tree.

## Dependency rule for shipped binaries

A shipped `ffmpeg` / `ffprobe` may only link libraries under `/usr/lib` and `/System` (macOS).
Anything else — Homebrew's `/opt/homebrew/...` for example — means the binary only works on the
build machine and must never be released. `build-config/build-ffmpeg-macos.sh` and
`build-config/build-pack.js` both enforce this and fail the build instead of shipping such a pair.
