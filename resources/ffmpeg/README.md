# FFmpeg runtime resources

Release builds must provide a reviewed `ffmpeg` and `ffprobe` pair in
`resources/ffmpeg/<platform>-<arch>/` before packaging. The accepted targets are
the same as the desktop release targets, for example `darwin-arm64`,
`darwin-x64`, `win32-x64`, and `linux-x64`.

The packer fails if either binary is absent; it must never produce a release
whose converter only works on the build machine. On macOS the packer also fails
when `ffmpeg` / `ffprobe` link anything outside `/usr/lib` and `/System` (for
example Homebrew's `/opt/homebrew/...`), because such a pair cannot load on a
user's machine.

Do not copy the `st-shazam` transitive binary or the GPL/nonfree
`eugeneware/ffmpeg-static` assets here. Each supplied pair must have a recorded
version, SHA-256, configure command, corresponding source offer, and applicable
license notices under `licenses/ffmpeg/` — see `licenses/ffmpeg/README.md` for
the current record. `build-config/build-ffmpeg-macos.sh` writes a
`BUILD-INFO.txt` next to the binaries it produces (release, source commit, LAME
SHA-256, configure command, binary SHA-256) so every source-built pair carries
its own provenance.
