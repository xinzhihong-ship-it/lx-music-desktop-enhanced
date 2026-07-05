<p align="center"><img width="160" src="./doc/images/icon.png" alt="LX Music Enhanced logo"></p>

<h1 align="center">LX Music 桌面版 · 增强版</h1>

<p align="center">
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases"><img src="https://img.shields.io/github/release/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="Release version"></a>
  <a href="https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xinzhihong-ship-it/lx-music-desktop-enhanced" alt="License"></a>
</p>

<p align="center">基于 <a href="https://github.com/lyswhut/lx-music-desktop">LX Music（洛雪音乐助手）桌面版</a> 的二次开发/增强版本。</p>

## 说明

本项目是 [LX Music 桌面版](https://github.com/lyswhut/lx-music-desktop) 的**个人魔改/增强 fork**，在保留原项目核心功能的基础上，针对日常使用中的痛点做了少量修改与增强。

### 主要改动

- **MPV 播放器增强**
  - 打包时自动下载并集成对应平台/架构的 mpv 二进制，减少终端用户手动配置成本。
  - 修复 MPV 播放状态同步问题，优化 `playing` / `pause` / `seeked` 等事件上报。
  - 改进启动恢复逻辑，支持启动后自动恢复上次播放。
  - 优化进度条拖动后的播放恢复行为。

- **自定义源（UserApi）修复**
  - 修复自定义源导入/列表返回数据在 Electron IPC 下无法被结构化克隆序列化的问题。
  - 增加关键路径日志，方便定位导入失败原因。

- **播放体验优化**
  - 新增播放音质标签，直观显示当前播放音质与使用的播放引擎。
  - 优化网络请求错误处理，对非 `Error` 类型的异常进行兜底转换。
  - 修复内置播放器在 seek 期间状态被误置为暂停的问题。

- **构建流程优化**
  - 新增 `npm run download:mpv` 脚本，支持按需下载指定平台 mpv。
  - 打包脚本会根据目标平台自动下载并集成 mpv 资源。

> 提示：由于本 fork 以个人使用为主，不保证与上游功能完全同步，也不会提供官方支持渠道。遇到问题请先查阅原项目文档。

### 支持平台

- Linux
- macOS
- Windows 7 及以上

技术栈与原项目保持一致：Electron 30+、Vue 3。

## 安装说明

### 方式一：直接下载 Release（推荐）

1. 打开本项目的 [Releases](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases) 页面。
2. 根据你的系统选择对应安装包：
   - **Windows**：`.exe` 安装程序 或 `.7z` 绿色版
   - **macOS**：`.dmg` 镜像
   - **Linux**：`.deb` / `.rpm` / `.AppImage` / `.pacman`
3. 下载后按常规方式安装/运行即可。

### 方式二：源码构建

如果你希望自己构建，或想基于本仓库继续二次开发，请参考以下步骤。

#### 环境要求

- [Node.js](https://nodejs.org/) >= 22
- [npm](https://www.npmjs.com/) >= 8.5.2
- Git
- 7-Zip（Windows 下构建时需要，用于解压 mpv 压缩包）

#### 1. 克隆仓库

```bash
git clone https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced.git
cd lx-music-desktop-enhanced
```

#### 2. 安装依赖

```bash
npm install
```

> 安装过程中 `electron-builder install-app-deps` 会自动执行，为本地原生依赖（如 `better-sqlite3`）编译对应 Electron 版本的二进制。

#### 3. 开发调试

```bash
npm run dev
```

启动开发服务器后，会自动打开 Electron 主窗口，并启用热更新。

#### 4. 构建生产版本

构建当前平台的目录版（不生成安装包）：

```bash
npm run build
```

构建当前平台的安装包：

```bash
# Windows x64 安装包
npm run pack:win:setup:x64

# macOS x64 dmg
npm run pack:mac:dmg

# Linux x64 deb
npm run pack:linux:deb:amd64
```

更多平台/架构请参阅 `package.json` 中的 `scripts` 字段。

#### 5. 关于 mpv 二进制

本项目默认会在打包时尝试自动下载对应平台的 mpv 二进制并集成到安装包中：

```bash
# 手动下载当前平台 mpv（开发调试用）
npm run download:mpv -- --platform=darwin --arch=arm64
```

- Windows / macOS 默认会自动下载。
- Linux 没有配置默认静态构建源，构建 Linux 包时请手动放置 mpv 到 `resources/mpv/linux-x64/`（或自行配置 `build-config/download-mpv.js` 中的 `SOURCES.linux`）。
- `resources/mpv/` 目录已被 `.gitignore` 忽略，不会提交到仓库。

> 注意：分发包含 mpv 的安装包时，请确保你遵守 mpv / FFmpeg 相关的 GPL/LGPL 许可证义务。

## 与上游项目的关系

- 上游项目：[lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)
- 本仓库基于上游代码进行修改，所有原始代码的版权归原项目作者所有。
- 本 fork 的改动部分由当前仓库维护者负责，不代表上游项目立场。

## 项目协议

本项目基于 [Apache License 2.0](./LICENSE) 许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。

---

*词语约定：本协议中的“本项目”指 LX Music（洛雪音乐助手）桌面版及其衍生项目；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。*

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

## 致谢

- 感谢 [lyswhut](https://github.com/lyswhut) 开发并开源 [LX Music](https://github.com/lyswhut/lx-music-desktop) 项目。
- 感谢 mpv、Electron、Vue 等开源项目提供的优秀基础设施。
