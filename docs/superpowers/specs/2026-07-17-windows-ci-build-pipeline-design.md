# Windows 构建管线（CI）与可用性修复 — 设计

日期：2026-07-17
状态：已确认（用户批准）

## 背景

- 全仓库排查结论：账号登录（网易云 wy / QQ音乐 tx / 酷狗 kg）、每日推荐（三家 `getDailyTrackIds` 均已实现）、QQ 歌词解密（`qrc_decode` win32 三架构预编译产物已在 `build-config/lib/`）、mpv 引擎运行时支持，**代码上全部已跨平台**，没有任何 mac 门控。
- 但从未产出过 Windows 安装包：`build/` 里只有 mac 的 dmg。卡点是 `better-sqlite3` —— 仓库只有 Linux 预置二进制（`build-config/lib/`），Mac 上无法交叉编译 Windows 的 `.node`。
- 仓库已继承上游完整 CI：`.github/workflows/beta-pack.yml`（push 到 `beta` 分支触发，产物为 workflow artifacts，无需任何密钥）、`release.yml`（push 到 `main` 触发，正式发布需要 `BT_TOKEN` 等密钥，本次不动）。
- 仓库 remote 是用户自己的 GitHub 仓库 `xinzhihong-ship-it/lx-music-desktop-enhanced`，可直接使用 Actions。

## 目标

能随时通过 GitHub Actions 产出 Windows 安装包（NSIS Setup x64/arm64 + 7z 绿色包），并修掉 Windows 版上「可见但必坏」的 Audirvana 引擎选项。

## 方案（已选定：GitHub Actions CI）

利用现有 `beta-pack.yml` 出包，windows-latest runner 上现场编译原生模块。已放弃的备选：Mac 交叉构建 + 预置 better-sqlite3 二进制（依赖官方预编译覆盖、打包脚本改造多）；用户 Windows 机器本地构建（需要装 VS Build Tools，人工步骤多）。

## 组件

### 1. beta-pack.yml 增加 `workflow_dispatch` 触发器

- 现有触发方式是 push 到 `beta` 分支；增加手动触发后，可在 GitHub 网页 Actions 页直接点「Run workflow」构建，不用折腾分支。
- 其余内容不动：win x64/arm64（setup + 7z）、win7、mac、linux 各 job 保留原样。

### 2. 依赖与原生模块（验证结论，无需改动）

- `better-sqlite3`：windows-latest runner 预装 MSVC Build Tools，`postinstall`（`electron-builder install-app-deps`）现场编译。
- `qrc_decode`：win32 x64/ia32/arm64 预编译产物已在仓库，`build-before-pack.js` 按平台复制。
- `audiotee`：无 `os` 限制、无安装脚本，Windows 上 `npm ci` 无害；仅 darwin 打包时捆绑。
- mpv：打包时 `download-mpv.js` 自动下载 win x64/arm64 二进制；win7/ia32 包不带内置 mpv（运行时回退到用户自装的 mpv，上游即如此）。
- `font-list`：win32 走脚本方案，无需编译。

### 3. 隐藏 Audirvana 引擎选项（子项目 C）

- `src/renderer/views/Setting/components/SettingPlay.vue` 的 `playEngineList`（electron/mpv/audirvana）在非 mac 平台过滤掉 `audirvana`。
- 现状：该选项无平台过滤，Windows 上选中后主进程 `audirvanaController.ts` 直接 reject，是「可见但必坏」的选项。

### 4. 触发与产物

- 方式一：GitHub 网页 Actions 页手动 Run workflow（`workflow_dispatch`）。
- 方式二：push `beta` 分支。
- 产物：workflow artifacts（`lx-music-desktop-x64-Setup`、`lx-music-desktop-arm64-Setup`、绿色 7z 等）。

## 验证

- 本机：YAML 语法校验；`npm run build`（webpack）在 mac 回归通过。
- CI：workflow 跑通，win 相关 artifacts 齐全即视为构建成功（CI 运行本身就是构建测试，本机无法替代）。
- Windows 实机（用户执行）：安装 Setup x64，验证——
  - 网易云 / QQ音乐 / 酷狗 扫码或 cookie 登录
  - 每日推荐加载
  - 听歌识曲：麦克风模式 + 系统音频模式（子项目 A 落地后）
  - 设置里播放引擎列表不再出现 Audirvana

## 不做（YAGNI）

- 不配置 `release.yml` 正式发布流程（需要 `BT_TOKEN` 等密钥，以后发正式版再配）。
- 不往仓库补 better-sqlite3 的 win32 预置二进制（CI 现场编译即可）。
- 不动 win7 兼容构建流程（electron 22 + undici 5 替换）。
- 不做代码签名。
