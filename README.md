<h1 align="center">LX Music 增强版</h1>

<p align="center">
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases"><img src="https://img.shields.io/github/release/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="Release version"></a>
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="License"></a>
</p>

<p align="center">简体中文 | <a href="./README.en.md">English</a></p>

<p align="center">开源项目 <a href="https://github.com/lyswhut/lx-music-desktop">LX Music 桌面版</a> 的非官方增强分支：播放更稳、输出更讲究、歌词全部重做，另有听歌识曲和 Folia 歌词动画对接。</p>

> [!IMPORTANT]
> - 这是**非官方**的个人分支，与 LX Music 原作者及其项目没有关系，也没有得到原作者认可。本版本的问题请到 [本仓库的 Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues) 反馈，不要去打扰原作者。
> - 本软件自身**不提供任何音频、歌词或封面**。播放链接来自你自己导入的「自定义源」、你在软件里登录的你自己的账号，或你粘贴的链接；能播什么、是什么音质，取决于这些来源给你的权限。请只使用你有权访问的内容。
> - 本分支新增和修改的代码（功能设计、实现、调试、文案）全部由 AI 编程助手完成，没有人工手写代码。仅供个人学习和技术交流。

## 这个版本加了什么

### 播放更稳

- 播放失败时自动恢复：刷新链接、换自定义源、换平台、降音质、放下一首。顺序可以拖动调整，重试次数和换源数量可以设置。
- 同一首歌查到的音质信息存进本地列表，重启后还在。
- 播放栏显示实际在放的音质和所用的播放引擎。

### 音质与输出

- 三种播放引擎：内置引擎、MPV（安装包自带）、Audirvana（仅 macOS，实验性）。详见下文「播放引擎说明」。
- MPV 的 **Bit Perfect 模式**：关掉重采样和音频滤镜，按原始采样率直通输出；开关时不打断正在放的歌。
- 内置引擎和 MPV 都能指定输出设备。
- **VST3 音效插件**（实验性，仅内置引擎）：插件链、插件参数界面、延迟补偿。插件在独立进程里运行，插件崩溃不影响播放器。
- 按歌曲查询平台提供的高音质档位（如高解析度、多声道、母带级）。能不能播、实际是哪一档，取决于平台、地区、版权和你所用的来源。

### 歌词

- 播放详情页：「滚动歌词」和「舞台」两种显示方式，舞台有流动、阶梯、倾诉三种风格；有逐字时间的歌词逐字点亮；可以用封面主色作背景。
- 桌面歌词：六种显示方式，在工具栏里直接调颜色、字号、透明度和歌词偏移。
- 顶部歌词岛：在屏幕顶部显示当前歌词，鼠标停留时展开成迷你播放器。macOS 另有菜单栏歌词。
- 歌词搜索与匹配：在多个平台同时搜歌词，选用的那份会记住；歌曲自带的歌词没有时间轴时，自动到其他平台找歌名、歌手、时长都对得上的。

### 听歌识曲

- 识别电脑正在播放的声音（系统音频），或麦克风收到的声音，每次采集 12 秒。
- 两个识别引擎同时跑，结果合并去重：主引擎基于开源的音频指纹算法；第二引擎 ACRCloud 可选，需要自己申请密钥（见下文附录），能认出更多现场版和翻唱。识别时音频指纹会发给对应的识别服务。
- 系统音频在 macOS 14.2 起可用（需授权「系统音频录制」），Windows 免授权；Linux 只能用麦克风。

### 账号与链接

- 在「设置」里的「平台账号管理」登录**你自己的**平台账号，在「平台音乐」页看每日推荐，以及你自建、收藏的歌单。
- 在搜索框粘贴受支持的视频网站链接（短链接也可以），把其中的音频加进播放队列。多 P 视频可以选 P，登录后可以选音质。

### 配合 Folia 显示歌词动画

[Folia](https://github.com/chthollyphile/folia-major) 是另一个开源播放器，以全屏歌词动画见长。本软件可以和它配合，**歌始终由本软件播放**：

- 配合 [Folia 落雪对接版](https://github.com/xinzhihong-ship-it/folia-major/releases)（同样是非官方分支）：在 Folia 里搜歌、看本软件的列表、控制播放，两边的播放状态、音量、播放模式和音质随时同步。在「设置 → 开放 API → Folia 对接」开启（默认开启）。
- 用官方 Folia：可以把正在放的歌和歌词推送给它的舞台模式，在「设置 → 开放 API → Folia 歌词舞台」开启。
- 对接接口只在本机（127.0.0.1）开放，带每次启动随机生成的令牌，浏览器里的网页调用不了。

### 其他

- WebDAV 同步歌单、设置和自定义源，覆盖本地数据前自动备份。
- 下载后可以转换音频格式（FLAC、ALAC、WAV、WavPack、MP3、AAC）。
- 界面改为 EasyUI 风格，新增「Easy · 晨光」「Easy · 夜色」主题。

## 下载与安装

到 [Releases](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases) 下载对应系统的安装包：

- **Windows**：`.exe` 安装程序，或 `.7z` 绿色版
- **macOS**：`.dmg`
- **Linux**：`.deb` / `.rpm` / `.AppImage` / `.pacman`

覆盖安装会保留原有设置和列表。标着 Pre-release 的是测试版。

### 支持的系统

- Windows 10 及以上（Windows 7 兼容包只是实验性的测试产物）
- macOS
- Linux

技术栈与原项目一致：Electron 40、Vue 3。

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 原项目的搜索、列表、播放、下载等功能 | ✅ | ✅ | ✅ |
| 平台账号（登录、每日推荐、歌单） | ✅ | ✅ | ✅ |
| 听歌识曲 · 系统音频 | ✅（14.2+） | ✅（免授权） | ❌ |
| 听歌识曲 · 麦克风 | ✅ | ✅ | ✅ |
| MPV 引擎（安装包自带） | ✅ | ✅（x64 / arm64） | ⚠️ 需自行安装 mpv |
| VST3 音效插件 | ✅ | ✅ | ✅（x64 / arm64 / armv7l） |
| Audirvana 引擎 | ✅ | ❌（设置中不显示） | ❌ |

> Windows x64 安装包实测过；Windows ARM64、Linux ARM 和 Windows 7 兼容包由 CI 构建，没有单独实测。Windows 7 兼容包不带 VST3 插件宿主。

## 播放引擎说明

在「设置 → 播放设置 → 播放引擎」切换：

| 引擎 | 特点 | 适用场景 |
|------|------|----------|
| **内置引擎** | 基于 Chromium 的音频播放，支持均衡器、混响、变调、3D 环绕等音效和 VST3 插件 | 日常使用、需要调音效 |
| **MPV 引擎** | 调用 mpv 播放，支持 Bit Perfect 模式和指定输出设备 | 想要高保真又不想另装软件 |
| **Audirvana**（仅 macOS） | 交给 Audirvana 输出，支持独占和 Bit Perfect | 已经装了 Audirvana、外接 DAC |

理论上的音质：**Audirvana ＞ MPV（开 Bit Perfect）＞ 内置引擎**。

- **Audirvana**：可以独占音频设备、绕过系统混音器，但只有 macOS，而且要另装 Audirvana。切到它以后，音效、变速、输出设备、音量由 Audirvana 自己管。
- **MPV + Bit Perfect**：关掉重采样和音频滤镜，按原始码率直通，性价比高。
- **内置引擎**：功能最多，但声音会经过 Chromium 的音频管线，可能被系统重采样。

> 实际听感还取决于音频本身的质量和 DAC、耳机、音箱。用普通设备听 128k / 320k 的音频，三者差别可能很小。

## 从源码构建

需要 [Node.js](https://nodejs.org/) 22 起、npm 8.5.2 起、Git；Windows 上构建还需要 7-Zip（解压 mpv）。

```bash
git clone https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced.git
cd lx-music-desktop-enhanced
npm install        # 会顺带为 better-sqlite3 等原生依赖编译对应 Electron 版本的二进制
npm run dev        # 开发调试，带热更新
npm run build      # 构建当前平台的目录版（不出安装包）
```

打安装包：

```bash
npm run pack:win:setup:x64     # Windows x64 安装包
npm run pack:mac:dmg           # macOS x64 dmg
npm run pack:linux:deb:amd64   # Linux x64 deb
```

其他平台和架构见 `package.json` 的 `scripts`。

### 关于 mpv

打包时会自动下载对应平台的 mpv 并放进安装包。开发时也可以手动下载：

```bash
npm run download:mpv -- --platform=darwin --arch=arm64
```

- Windows、macOS 默认自动下载。
- Linux 没有默认的静态构建来源：构建 Linux 包前，把 mpv 放到 `resources/mpv/linux-x64/`，或者在 `build-config/download-mpv.js` 的 `SOURCES.linux` 里配一个来源。
- `resources/mpv/` 已被 `.gitignore` 忽略。
- 分发带 mpv 的安装包时，请遵守 mpv 和 FFmpeg 的 GPL / LGPL 许可证义务。

## 反馈、Bug 与建议

感谢每一位提交 Bug、建议和使用反馈的朋友，你们给的复现步骤和使用场景帮这个项目发现了很多问题。

播放失败、显示异常、登录或音源问题、新功能建议，都欢迎在 [GitHub Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues) 提出。报 Bug 时请尽量附上软件版本、操作系统、播放引擎、复现步骤，以及必要的日志或截图；**先遮掉账号、Cookie、密钥等隐私信息**。

本分支以个人使用为主，不保证和原项目同步，也没有官方支持渠道。原项目的通用问题可以先看 [原项目文档](https://lyswhut.github.io/lx-music-doc/)。

## 附：申请 ACRCloud 密钥（可选）

ACRCloud 是听歌识曲的**可选第二引擎**，用来认主引擎认不出的现场版、翻唱录音。不配置也不影响主引擎。

1. 打开 [ACRCloud 控制台](https://console.acrcloud.cn/)，注册并登录（国际站是 [console.acrcloud.com](https://console.acrcloud.com/)）。
2. 在控制台首页选「**音频指纹识别**」，进入 AVR 控制台。
3. 依次点「**项目 → 音视频识别 → 创建项目**」。「音频类型」按主要用法选：主要识别**系统音频**选「原始文件或流媒体（未包含噪音）」；主要用**麦克风**选「通过麦克风采集的音频（包含噪音）」。
4. 创建后进入项目详情页，能看到 **Host**（如 `identify-cn-north-1.acrcloud.cn`）、**Access Key**、**Access Secret** 三项。
5. 回到本软件「听歌识曲 → 识别引擎」，勾选「启用 ACRCloud 双引擎识别」，填入这三项并保存。

> ACRCloud 是商业服务，新项目有免费额度，超出要付费，以其官网价格为准。密钥只存在本机，识别请求由本机直接发给 ACRCloud。

## 与原项目的关系

- 原项目：[lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)。本仓库在它的代码上修改，原始代码的版权归原项目作者所有。
- 本分支的改动由本仓库维护者负责，不代表原项目的立场。
- 「LX Music」「洛雪音乐」的名称和图标属于原项目作者。本分支沿用它们只是为了说明代码的来源；如果原作者认为不妥，请在 Issues 联系，我们会更改。

## 商标与版权声明

- 文中和软件里提到的音乐平台、视频网站、识别服务和软件（如 Folia、Audirvana、ACRCloud、mpv）的名称与商标，归各自所有者所有，只用来说明兼容性。本项目与它们没有任何合作、从属或认可关系。VST 是 Steinberg Media Technologies GmbH 的注册商标。
- 歌曲、歌词、专辑封面等内容的版权归各自权利人。本项目不提供这些内容，也不鼓励任何侵犯版权的用法。请尊重版权，支持正版。
- 如果你是权利人，认为本仓库的内容侵犯了你的权益，请在 [Issues](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/issues) 联系，我们核实后会尽快处理。

## 项目协议

本项目基于 [Apache License 2.0](./LICENSE) 发行。以下协议来自原项目，是对 Apache License 2.0 的补充；两者冲突时，以以下协议为准。安装时显示的版本见 [licenses/](licenses/)。

---

*词语约定：本协议中的“本项目”指 LX Music（洛雪音乐助手）桌面版及其衍生项目；“使用者”指签署本协议的使用者；“官方音乐平台”指本项目内置的各音乐源所对应的官方平台的统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。*

### 一、数据来源

1.1 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据（与未登录状态在官方平台 APP 获取的数据相同），经过对数据简单地筛选与合并后进行展示，因此本项目不对数据的合法性、准确性负责。

1.2 本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内“自定义源”设置所选择的“源”返回的在线链接。例如播放某首歌，本项目所做的只是将希望播放的歌曲名、艺术家等信息传递给“源”，若“源”返回了一个链接，则本项目将认为这就是该歌曲的音频数据而进行使用，至于这是不是正确的音频数据本项目无法校验其准确性，所以使用本项目的过程中可能会出现希望播放的音频与实际播放的音频不对应或者无法播放的问题。

1.3 本项目的非官方平台数据（例如“我的列表”内列表）来自使用者本地系统或者使用者连接的同步服务，本项目不对这些数据的合法性、准确性负责。

### 二、版权数据

2.1 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。

### 三、音乐平台别名

3.1 本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。如果官方音乐平台觉得不妥，可联系本项目更改或移除。

### 四、资源使用

4.1 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。

### 五、免责声明

5.1 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。

### 六、使用限制

6.1 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。本项目不对项目内的技术可能存在违反当地法律法规的行为作保证。

6.2 **禁止在违反当地法律法规的情况下使用本项目。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。

### 七、版权保护

7.1 音乐平台不易，请尊重版权，支持正版。

### 八、非商业性质

8.1 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。

### 九、接受协议

9.1 若你使用了本项目，即代表你接受本协议。

---

## 引用与致谢

本项目基于以下开源项目和服务构建，感谢它们的作者：

| 项目 | 作者 | 许可 | 用途 |
|------|------|------|------|
| [LX Music 桌面版](https://github.com/lyswhut/lx-music-desktop) | lyswhut | Apache-2.0 | 原项目，本分支全部基础功能的来源 |
| [mpv](https://mpv.io/) | mpv 团队 | GPL-2.0 / LGPL-2.1 | MPV 播放引擎 |
| [AudioTee](https://github.com/makeusabrew/audiotee) | Nick Payne | MIT | macOS 系统音频采集（听歌识曲） |
| [ST-Shazam](https://github.com/sheikhtamimlover/ST-Shazam) | Sheikh Tamim | MIT | 音频指纹算法（听歌识曲主引擎） |
| [rust-vst3-host](https://github.com/HelgeSverre/rust-vst3-host) | Helge Sverre | MIT | VST3 插件宿主 |
| [vst3-rs](https://github.com/coupler-rs/vst3-rs) | coupler-rs | MIT / Apache-2.0 | VST3 接口绑定 |
| [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) | Binaryify | MIT | 接口请求加密的实现参考 |
| [ACRCloud](https://www.acrcloud.cn/) | ACRCloud | 商业服务（有免费额度） | 听歌识曲第二引擎（需自行申请密钥） |

第三方许可原文见 [licenses/](licenses/)。Audirvana 是其所有者的产品，本项目只通过它公开的脚本接口调用，不捆绑它的程序。

另外感谢 [lyswhut](https://github.com/lyswhut) 开发并开源 LX Music，感谢 mpv、Electron、Vue 等开源项目。
