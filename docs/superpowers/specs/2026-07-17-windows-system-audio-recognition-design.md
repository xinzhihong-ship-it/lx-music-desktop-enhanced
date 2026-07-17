# Windows 系统音频听歌识曲 — 设计

日期：2026-07-17
状态：已确认（用户批准）

## 背景

- 现状：系统音频识别仅支持 macOS 14.2+，由 `audiotee` 二进制（macOS Audio Tap API）采集，`src/main/modules/musicRecognition/capture.ts` 的 `isMusicRecognitionSupported()` 在非 darwin 平台直接返回 `false`。
- 识别引擎本身跨平台：Shazam 指纹由纯 JS 库 `st-shazam` 本地计算后经 HTTP 请求识别，ACRCloud 也是纯 HTTP API。
- 麦克风模式（`src/renderer/views/MusicRecognition/micCapture.ts`）基于渲染进程 `getUserMedia`，已跨平台可用。

## 目标

Windows 上使用「系统音频」来源时，可识别其他 App（或 LX 自身）正在播放的声音。macOS 行为零变化；Linux 维持系统音频不支持。

同时修复入口门控问题：`NavBar.vue:75` 把听歌识曲入口写死 `enable: isMac`，导致 Windows 上连本已可用的麦克风模式也被隐藏。入口改为全平台开放。

## 方案（已选定：渲染进程 loopback）

**选定**：Electron `setDisplayMediaRequestHandler` + 渲染进程 `getDisplayMedia`（`audio: 'loopback'`，底层 WASAPI loopback）。零新增原生依赖，Electron 40 原生支持，Windows 无权限弹窗。

已放弃的备选：

- Windows 原生采集二进制（与 audiotee 对称）：需要交叉编译、代码签名、随包分发，维护成本高。
- 打包 ffmpeg `-f wasapi` loopback：包体增加约 30–80MB，ffmpeg wasapi 兼容性一般。

## 架构与数据流

Windows 的系统音频采集在渲染进程完成，与 mic 模式同构：

```
view.handleStart (source='system')
  → store.startSystemRecognition            （按平台分流）
  → systemAudioCapture（渲染进程采集 12s，进度回调，可停止）
  → resampleTo16kInt16 → Int16 PCM
  → recognizeMusicFromMic IPC（现有）
  → main: service.recognizeMicPcm（现有）
  → runRecognition（Shazam + ACRCloud 并行、候选合并、历史，现有）
  → snapshot 推送（现有）
```

识别链路、结果合并、历史记录零改动。macOS 的 audiotee 路径保持原样。

## 组件

### 1. 主进程：display media handler

- 文件：`src/main/modules/musicRecognition/index.ts`
- 仅 `process.platform === 'win32'` 时，对 defaultSession 注册 `setDisplayMediaRequestHandler`：用 `desktopCapturer.getSources({ types: ['screen'] })` 取第一个屏幕源，`callback({ video: source, audio: 'loopback' })`，无选择器弹窗。
- 已确认全项目无其他 `getDisplayMedia` / `desktopCapturer` 使用，handler 无冲突。

### 2. 渲染进程：`systemAudioCapture.ts`（新增）

- 位置：`src/renderer/views/MusicRecognition/systemAudioCapture.ts`
- API 对齐 `micCapture.ts`：`startSystemAudioCapture(onProgress) → { promise, stop }`
- `getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`
- 拿到流后立即停止并移除 video track，只留音轨；无 audio track → 抛 `SystemAudioUnavailableError`
- AudioContext + ScriptProcessor 收集 Float32 采样，目标 12 秒，带进度回调（与 mic 模式一致）
- 重采样：从 `micCapture.ts` 导出 `resampleTo16kInt16` 复用（同目录，不抽新文件）
- 静音检测：RMS 阈值与主进程 `hasAudibleSignal` 一致（≥ 32），整体静音 → 抛 `SystemNoAudioError`
- 错误类型：`SystemCancelledError` / `SystemAudioUnavailableError` / `SystemNoAudioError`

### 3. store：`startSystemRecognition`

- 文件：`src/renderer/store/musicRecognition.ts`
- 平台分流：win32 → 渲染进程采集 + `recognizeMusicFromMic` IPC；darwin → 现有 `startMusicRecognition`（audiotee）
- 平台判断：使用项目现有的 `isWin` / `isMac`（`@common/utils`，渲染进程已在多处使用）
- 错误映射：`SystemCancelledError` → idle；`SystemNoAudioError` → noAudio；`SystemAudioUnavailableError` 及其他 → error（携带明确文案）

### 4. view：`index.vue`

- `handleStart` 的 system 分支改调 `startSystemRecognition`，其余不变。
- win32 下不再出现 `unsupported` 状态；Linux 仍显示现有 `status_unsupported` 文案。

### 5. service / capture（主进程）

- 「功能是否可用」（决定 snapshot 初始 status 是 idle 还是 unsupported）：darwin 检查 14.2+，win32 为 true，其他为 false。
- 「主进程能否采集」（audiotee 路径的门）：仍仅 darwin 14.2+。
- 拆成两个独立判断函数，避免误用；`recognizeMicPcm` 不改。

### 6. 导航入口：NavBar.vue

- `src/renderer/components/layout/Aside/NavBar.vue:75` 的 `enable: isMac` 门控删除，听歌识曲入口全平台可见。
- 效果：Windows 得到「麦克风 + 系统音频(loopback)」两种模式；Linux 得到麦克风模式（系统音频点开始后显示现有 `status_unsupported` 文案）。

## 错误处理

- 取消 / 停止 / 关窗：沿用现有 `stopRecognition` + capture handle `stop()` + sender destroyed 清理。
- 无音轨 / 采集被拒：`error` 状态，文案「无法采集系统音频（未检测到系统播放设备）」。
- 静音：`noAudio` 状态，文案「未采集到系统声音，请确认正在播放歌曲」。Windows 无权限概念，不做权限引导。

## i18n

zh-cn / zh-tw / en-us 增补两条文案：系统音频不可用、未采集到系统声音（Windows 版，无权限引导）。其余复用现有状态文案。

## 测试与验证

- 本机（macOS）：项目现有的 typecheck / lint 通过；mac 路径回归（audiotee 识别不受影响）。
- Windows 路径无法在本机端到端联调（macOS 上 Chrome loopback 拿不到音轨），需 Windows 实机跑开发模式验证：
  - 识别其他 App 播放的歌曲
  - 识别 LX 自身播放的歌曲
  - 未播放任何声音时的静音提示
  - 采集中途停止 / 取消
- 验证清单纳入实现计划。

## 不做（YAGNI）

- 不改识别引擎、历史记录、ACRCloud 配置 UI。
- 不做 Linux 系统音频。
- 不引入任何新依赖或二进制。
- 不动 audiotee 与 mac 打包配置。
