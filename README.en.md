<h1 align="center">LX Music Enhanced</h1>

<p align="center">
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases"><img src="https://img.shields.io/github/release/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="Release version"></a>
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="License"></a>
</p>

<p align="center"><a href="./README.md">简体中文</a> | English</p>

<p align="center">An unofficial, enhanced fork of the open-source <a href="https://github.com/lyswhut/lx-music-desktop">LX Music Desktop</a>: steadier playback, careful audio output, fully reworked lyrics, song recognition, and pairing with Folia's lyric animations.</p>

> [!IMPORTANT]
> - This is an **unofficial** personal fork. It is not affiliated with, or endorsed by, the author of LX Music. Please report problems with this fork in [this repository's Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues), not to the original author.
> - The app itself **provides no audio, lyrics or cover art**. Playback links come from the "custom sources" you import, from accounts of your own that you sign in to, or from links you paste. What you can play, and at what quality, depends on what those sources allow you. Only use content you have the right to access.
> - All code added or changed in this fork (design, implementation, debugging, wording) was written by AI coding assistants; none of it was written by hand. It is for personal learning and technical exchange only.

## What this fork adds

### Steadier playback

- Automatic recovery when a track fails: refresh the link, try another custom source, try another platform, lower the quality, or skip to the next track. You can drag these steps into your preferred order and set the number of retries and sources to try.
- Quality information found for a track is saved to your local lists and survives restarts.
- The player bar shows the quality actually playing and the playback engine in use.

### Quality and output

- Three playback engines: built-in, MPV (bundled with the installer), and Audirvana (macOS only, experimental). See "Playback engines" below.
- MPV **Bit Perfect mode**: turns off resampling and audio filters and passes audio through at its original sample rate. Toggling it does not interrupt the current track.
- Both the built-in engine and MPV can output to a chosen device.
- **VST3 effect plugins** (experimental, built-in engine only): plugin chains, plugin editors and latency compensation. Plugins run in a separate process, so a crashing plugin does not take the player down.
- Looks up the higher quality tiers a platform offers for a track (such as hi-res, multichannel or master quality). Whether a tier plays, and which one you actually get, depends on the platform, your region, licensing and the source you use.

### Lyrics

- Now-playing page: "scrolling" and "stage" layouts, with three stage styles (Flow, Steps, Confide); word-by-word highlighting when the lyrics carry word timings; optional background in the cover's main color.
- Desktop lyrics: six layouts, with color, size, opacity and timing offset adjustable right from the toolbar.
- Lyrics island: shows the current line at the top of the screen and expands into a mini player on hover. On macOS there are menu-bar lyrics as well.
- Lyrics search and matching: search lyrics on several platforms at once, and the one you pick is remembered. When a track's own lyrics have no timings, the app looks on other platforms for a version whose title, artist and duration all match.

### Song recognition

- Identifies what your computer is playing (system audio) or what your microphone hears, from a 12-second capture.
- Two engines run side by side and their results are merged: the main engine uses an open-source audio-fingerprint algorithm; the optional second engine, ACRCloud, needs a key you apply for yourself (see the appendix) and recognizes more live and cover recordings. Fingerprints are sent to the matching recognition service.
- System audio works on macOS 14.2+ (grant "System Audio Recording") and on Windows with no permission needed; Linux supports the microphone only.

### Accounts and links

- Sign in to **your own** platform accounts with "Platform Accounts" in Settings, then browse your daily recommendations and the playlists you created or saved on the "Platform Music" page.
- Paste a link from a supported video site (short links work too) into the search box to add its audio to the queue. Multi-part videos let you pick a part; signing in unlocks quality choices.

### Lyric animations with Folia

[Folia](https://github.com/chthollyphile/folia-major) is another open-source player known for full-screen lyric animations. This app can work with it, and **this app always does the playing**:

- With the [Folia LX edition](https://github.com/xinzhihong-ship-it/folia-major/releases) (also an unofficial fork): search, browse this app's lists and control playback from Folia, with play state, volume, play mode and quality kept in sync both ways. Turn it on in Settings → Open API → Folia link (on by default).
- With the official Folia: push the current track and its lyrics to Folia's stage mode, under Settings → Open API → Folia Lyrics Stage.
- The link listens only on this machine (127.0.0.1) and requires a token generated at every launch; web pages in a browser cannot call it.

### Other

- WebDAV sync for lists, settings and custom sources, with an automatic backup before local data is overwritten.
- Convert downloaded audio to FLAC, ALAC, WAV, WavPack, MP3 or AAC.
- An EasyUI-style interface with two new themes, "Easy · Morning" and "Easy · Night".

## Download

Get the installer for your system from [Releases](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases):

- **Windows**: `.exe` installer or portable `.7z`
- **macOS**: `.dmg`
- **Linux**: `.deb` / `.rpm` / `.AppImage` / `.pacman`

Installing over an existing copy keeps your settings and lists. Releases marked Pre-release are test builds.

### Supported systems

- Windows 10 or later (the Windows 7 build is an experimental by-product)
- macOS
- Linux

Same stack as the original project: Electron 40 and Vue 3.

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Original features: search, lists, playback, downloads | ✅ | ✅ | ✅ |
| Platform accounts (sign-in, daily picks, playlists) | ✅ | ✅ | ✅ |
| Song recognition · system audio | ✅ (14.2+) | ✅ (no permission needed) | ❌ |
| Song recognition · microphone | ✅ | ✅ | ✅ |
| MPV engine (bundled) | ✅ | ✅ (x64 / arm64) | ⚠️ install mpv yourself |
| VST3 effect plugins | ✅ | ✅ | ✅ (x64 / arm64 / armv7l) |
| Audirvana engine | ✅ | ❌ (hidden in settings) | ❌ |

> The Windows x64 installer has been tested by hand. Windows ARM64, Linux ARM and the Windows 7 build are produced by CI and not tested separately. The Windows 7 build does not include the VST3 plugin host.

## Playback engines

Switch engines in Settings → Playback → Playback Engine:

| Engine | What it does | Good for |
|--------|--------------|----------|
| **Built-in** | Chromium audio playback with EQ, reverb, pitch shift, 3D surround and VST3 plugins | Everyday listening, tweaking effects |
| **MPV** | Plays through mpv, with Bit Perfect mode and a selectable output device | High fidelity without installing anything else |
| **Audirvana** (macOS only) | Hands playback to Audirvana, with exclusive and Bit Perfect output | You already use Audirvana with an external DAC |

Theoretical sound quality: **Audirvana > MPV (Bit Perfect on) > built-in**.

- **Audirvana** can take exclusive control of the audio device and bypass the system mixer, but it is macOS-only and must be installed separately. While it is selected, effects, speed, output device and volume are managed by Audirvana.
- **MPV + Bit Perfect** turns off resampling and audio filters and passes the source through untouched; good value.
- **Built-in** has the most features, but audio goes through Chromium's pipeline and may be resampled by the system.

> What you hear also depends on the audio itself and on your DAC, headphones and speakers. With ordinary gear and 128k / 320k audio, the three may sound much the same.

## Building from source

You need [Node.js](https://nodejs.org/) 22+, npm 8.5.2+ and Git; building on Windows also needs 7-Zip (to unpack mpv).

```bash
git clone https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced.git
cd lx-music-desktop-enhanced
npm install        # also builds native dependencies such as better-sqlite3 for this Electron version
npm run dev        # development build with hot reload
npm run build      # unpacked build for the current platform (no installer)
```

Installers:

```bash
npm run pack:win:setup:x64     # Windows x64 installer
npm run pack:mac:dmg           # macOS x64 dmg
npm run pack:linux:deb:amd64   # Linux x64 deb
```

See `scripts` in `package.json` for other platforms and architectures.

### About mpv

Packaging downloads mpv for the target platform and puts it in the installer. For development you can download it by hand:

```bash
npm run download:mpv -- --platform=darwin --arch=arm64
```

- Windows and macOS download it automatically.
- Linux has no default static build source: before building a Linux package, put mpv in `resources/mpv/linux-x64/`, or configure a source in `SOURCES.linux` in `build-config/download-mpv.js`.
- `resources/mpv/` is ignored by git.
- If you distribute installers that include mpv, meet the GPL / LGPL obligations of mpv and FFmpeg.

## Feedback

Thanks to everyone who has reported bugs, suggested improvements or shared how they use the app; your reproduction steps and use cases have found many problems.

Playback failures, display glitches, sign-in or source problems and feature ideas are all welcome in [GitHub Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues). For bugs, please include the app version, operating system, playback engine, steps to reproduce, and logs or screenshots where useful. **Remove account names, cookies, keys and other private data first.**

This fork is mainly for personal use. It does not promise to keep up with the original project and has no official support channel. For general questions about the original app, see the [original documentation](https://lyswhut.github.io/lx-music-doc/) (Chinese).

## Appendix: getting an ACRCloud key (optional)

ACRCloud is the **optional second engine** for song recognition, for live and cover recordings the main engine misses. Without it, the main engine works as usual.

1. Open the [ACRCloud console](https://console.acrcloud.com/) and sign up or sign in (the China site is [console.acrcloud.cn](https://console.acrcloud.cn/)).
2. On the console home page choose **Audio Fingerprinting** to open the AVR console.
3. Create a new audio & video recognition project. For the audio type, pick the option for clean original or streamed audio (no noise) if you will mostly recognize **system audio**, or the option for audio recorded through a microphone (with noise) if you will mostly use the **microphone**.
4. Open the new project to see its **Host** (such as `identify-eu-west-1.acrcloud.com`), **Access Key** and **Access Secret**.
5. In the app, open Music Recognition → Engines, tick "Enable ACRCloud dual-engine recognition", enter the three values and save.

> ACRCloud is a commercial service. New projects have a free allowance and are paid beyond that; see its pricing page. The key stays on your computer, and recognition requests go straight from your computer to ACRCloud.

## Relationship to the original project

- Original project: [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop). This repository modifies its code; copyright in the original code belongs to its author.
- Changes in this fork are the responsibility of this repository's maintainer and do not represent the original project.
- The names "LX Music" and "洛雪音乐" and the app icon belong to the original author. This fork keeps them only to show where the code comes from; if the original author objects, please open an issue and they will be changed.

## Trademarks and copyright

- Names and trademarks of music platforms, video sites, recognition services and software mentioned here or in the app (such as Folia, Audirvana, ACRCloud and mpv) belong to their respective owners and are used only to describe compatibility. This project has no partnership with, affiliation to, or endorsement from any of them. VST is a registered trademark of Steinberg Media Technologies GmbH.
- Songs, lyrics, cover art and other content belong to their rights holders. This project does not provide such content and does not encourage any use that infringes copyright. Please respect copyright and support the artists.
- If you hold rights and believe something in this repository infringes them, please contact us through [Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues); we will check and act promptly.

## Project agreement

This project is released under the [Apache License 2.0](./LICENSE). The agreement below comes from the original project and supplements the Apache License 2.0; where they conflict, the agreement prevails. It is translated from the Chinese agreement in [README.md](./README.md#项目协议); if the two differ, the Chinese version prevails.

---

*Definitions: "This project" means LX Music Desktop and projects derived from it. "User" means a user who accepts this agreement. "Official music platforms" means, collectively, the official platforms behind the music sources built into this project. "Copyrighted data" means data in which others own the copyright, including but not limited to images, audio and names.*

### 1. Data sources

1.1 This project's online data from the official platforms is fetched from their public servers (the same data the official platform apps show when not signed in), then simply filtered and merged for display. This project is therefore not responsible for the legality or accuracy of that data.

1.2 This project has no ability of its own to obtain audio. The online audio it uses comes from links returned by the "source" chosen under "custom sources" in the settings. When you play a song, all this project does is pass the song title, artist and similar information to the source; if the source returns a link, this project treats it as the song's audio. This project cannot verify that the audio is correct, so what plays may not match what you wanted, or may not play at all.

1.3 Data that does not come from the official platforms (such as the lists in "My lists") comes from the user's own system or from a sync service the user connects to. This project is not responsible for the legality or accuracy of that data.

### 2. Copyrighted data

2.1 Copyrighted data may be produced while using this project. This project does not own that data. To avoid infringement, users must delete copyrighted data produced while using this project **within 24 hours**.

### 3. Platform aliases

3.1 The aliases this project uses for official music platforms are only names used within the project and carry no ill intent. If an official music platform finds them inappropriate, it may contact this project to have them changed or removed.

### 4. Resources

4.1 Some resources used in this project, including but not limited to fonts and images, come from the internet. If anything infringes your rights, contact this project to have it removed.

### 5. Disclaimer

5.1 The user bears all direct, indirect, special, incidental or consequential damages of any kind arising from this agreement or from the use of, or inability to use, this project, including but not limited to loss of goodwill, work stoppage, computer failure or malfunction, and any other commercial damages or losses.

### 6. Restrictions on use

6.1 This project is completely free and is published as open source on GitHub for people around the world to learn about and exchange ideas on technology. This project makes no guarantee that its techniques comply with local laws and regulations.

6.2 **Do not use this project in violation of local laws and regulations.** The user alone is responsible for any violation resulting from using this project where local law does not allow it, whether or not the user knew; this project bears no direct, indirect, special, incidental or consequential liability for it.

### 7. Copyright protection

7.1 Running a music platform is not easy. Please respect copyright and support licensed music.

### 8. Non-commercial

8.1 This project exists only to explore and study technical feasibility. It accepts no commercial cooperation of any kind (including but not limited to advertising) and no donations.

### 9. Acceptance

9.1 Using this project means you accept this agreement.

---

## Credits

This project is built on the following open-source projects and services. Thanks to their authors:

| Project | Author | License | Used for |
|---------|--------|---------|----------|
| [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) | lyswhut | Apache-2.0 | The original project; the base of everything in this fork |
| [mpv](https://mpv.io/) | the mpv team | GPL-2.0 / LGPL-2.1 | MPV playback engine |
| [AudioTee](https://github.com/makeusabrew/audiotee) | Nick Payne | MIT | macOS system audio capture (song recognition) |
| [ST-Shazam](https://github.com/sheikhtamimlover/ST-Shazam) | Sheikh Tamim | MIT | Audio-fingerprint algorithm (main recognition engine) |
| [rust-vst3-host](https://github.com/HelgeSverre/rust-vst3-host) | Helge Sverre | MIT | VST3 plugin host |
| [vst3-rs](https://github.com/coupler-rs/vst3-rs) | coupler-rs | MIT / Apache-2.0 | VST3 interface bindings |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | Binaryify | MIT | Reference for request encryption |
| [ACRCloud](https://www.acrcloud.com/) | ACRCloud | Commercial service (free allowance) | Second recognition engine (bring your own key) |

Third-party license texts are in [licenses/](licenses/). Audirvana is its owner's product; this project only calls its public scripting interface and does not bundle its software.

Thanks also to [lyswhut](https://github.com/lyswhut) for creating and open-sourcing LX Music, and to mpv, Electron, Vue and the other open-source projects this builds on.
