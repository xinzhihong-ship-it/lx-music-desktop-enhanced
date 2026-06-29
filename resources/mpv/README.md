# mpv sidecar resources

This directory defines the optional mpv sidecar layout for the high-fidelity external playback engine.

Place platform mpv binaries here when preparing a distributable build:

- `resources/mpv/darwin-arm64/mpv`
- `resources/mpv/darwin-x64/mpv`
- `resources/mpv/win32-x64/mpv.exe`
- `resources/mpv/linux-x64/mpv`

Do **not** commit real mpv binaries to this repository. Keep only placeholders and documentation in source control.

Runtime lookup order:

1. User configured `player.mpv.path`
2. Production bundled binary under `process.resourcesPath/bin/mpv` or `process.resourcesPath/bin/mpv.exe`
3. Development bundled binary under this `resources/mpv/<platform>-<arch>/` directory
4. `mpv` / `mpv.exe` from system `PATH`
5. Common install paths for macOS, Windows, and Linux

Packaging convention:

- The current platform directory should be copied into the installed app resources as `resources/bin/`.
- For example, `resources/mpv/darwin-arm64/mpv` becomes `<app resources>/bin/mpv`.
- Users can still override the binary by setting `player.mpv.path`.

Licensing:

mpv and FFmpeg may involve GPL/LGPL and other third-party licenses. Before distributing installers that include mpv, ship the corresponding license notices and source-offer/source-obtaining instructions required by those projects and by the exact binary build you distribute.
