# FFmpeg runtime resources

Release builds must provide a reviewed `ffmpeg` and `ffprobe` pair in
`resources/ffmpeg/<platform>-<arch>/` before packaging. The accepted targets are
the same as the desktop release targets, for example `darwin-arm64`,
`darwin-x64`, `win32-x64`, and `linux-x64`.

The packer fails if either binary is absent; it must never produce a release
whose converter only works on the build machine.

Do not copy the `st-shazam` transitive binary or the GPL/nonfree
`eugeneware/ffmpeg-static` assets here. Each supplied pair must have a recorded
version, SHA-256, configure command, corresponding source offer, and applicable
license notices under `licenses/ffmpeg/`.
