# mpv sidecar resources

This directory defines the optional mpv sidecar layout for the high-fidelity external playback engine.

Place platform mpv binaries here when preparing a distributable build:

- macOS: `resources/mpv/darwin-arm64/mpv.app/Contents/MacOS/mpv` (or `resources/mpv/darwin-x64/mpv.app/Contents/MacOS/mpv`)
- Windows: `resources/mpv/win32-x64/mpv.exe` (or `resources/mpv/win32-arm64/mpv.exe`)
- Linux: `resources/mpv/linux-x64/mpv` (or `resources/mpv/linux-arm64/mpv`, `resources/mpv/linux-armv7l/mpv`)

Do **not** commit real mpv binaries to this repository. Keep only placeholders and documentation in source control.

## Auto-download

You can let the build system download mpv automatically:

```bash
# macOS
npm run download:mpv -- --platform=darwin --arch=arm64

# Windows
npm run download:mpv -- --platform=win32 --arch=x64
npm run download:mpv -- --platform=win32 --arch=arm64

# Linux (no default static source; set SOURCES.linux.url in download-mpv.js first)
npm run download:mpv -- --platform=linux --arch=x64
```

`npm run pack:*` / `npm run publish:*` will also call this automatically before electron-builder starts, so end users do not need to install mpv themselves.

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
