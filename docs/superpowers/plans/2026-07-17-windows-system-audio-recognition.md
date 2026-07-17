# Windows 系统音频听歌识曲 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 上「系统音频」来源的听歌识曲可用（Electron loopback 采集），并把被 `isMac` 门控隐藏的识曲入口全平台开放。

**Architecture:** Windows 的系统音频采集在渲染进程完成（`getDisplayMedia` + 主进程 `setDisplayMediaRequestHandler` 的 `audio: 'loopback'`），产出的 16kHz Int16 PCM 复用现有 `music_recognition_recognize_mic` IPC 进入主进程识别链路（Shazam + ACRCloud）。macOS 的 audiotee 路径零改动。

**Tech Stack:** Electron 40、Vue 3、TypeScript、无新增依赖。

**对应 Spec:** `docs/superpowers/specs/2026-07-17-windows-system-audio-recognition-design.md`

## Global Constraints

- 仓库：`/Volumes/存储/Applications/洛雪改造/lx-music-desktop`（路径含中文和空格，shell 命令中目录要加引号）。
- 不新增任何 npm 依赖。
- 仓库**没有单元测试框架**：验证以 `npm run build`（webpack 编译）+ `npm run lint` + 手动冒烟为准，不为本次改动引入测试基建。
- 错误文案跟随现有惯例直接硬编码中文（参照 `capture.ts` / `store/musicRecognition.ts` 的现有写法），**不新增 i18n key**（这一条取代 spec 的「i18n」节：排查后确认状态文案 key 已全部存在，错误详情字符串在现有代码里就是硬编码中文）。
- macOS 行为零变化：audiotee 采集、权限引导文案、`startRecognition` 的 darwin 14.2+ 门控全部保持原样。
- 提交信息风格参照 git log：中文 conventional commits（如 `feat: 新增听歌识曲与平台音乐账号功能`）。
- 每次 `git commit` 前先向用户确认（本仓库的硬性规则）。

---

### Task 1: 主进程注册 Windows loopback 采集 handler

**Files:**
- Modify: `src/main/modules/musicRecognition/index.ts`

**Interfaces:**
- Consumes: 主窗口的 session partition（`persist:win-main`，见 `src/main/modules/winMain/main.ts:69,91`）——handler 必须注册到这个 session 上。
- Produces: win32 下 `persist:win-main` session 的 display media handler——Task 2 的渲染进程 `getDisplayMedia` 依赖它才能拿到 loopback 音轨。

**背景:** 模块的默认导出函数由 `src/main/modules/index.ts` 的 `registerModules()` 调用，而 `src/main/index.ts:37` 在 `app.whenReady()` 之后才调用它，所以这里可以直接安全地访问 `session`。注意：`setDisplayMediaRequestHandler` 按 session（partition）隔离，主窗口用的是 `session.fromPartition('persist:win-main')` 而非 `session.defaultSession`，注册错 session 会导致 handler 永不触发（终审实测发现，已修复）。

- [ ] **Step 1: 修改 `src/main/modules/musicRecognition/index.ts`**

第 1 行的 import 改为：

```ts
import { app, desktopCapturer, session } from 'electron'
```

在 `let isInitialized = false` 之后、默认导出函数之前，新增：

```ts
// Windows 系统音频采集：渲染进程 getDisplayMedia 时自动授权主屏 + 系统混音（loopback），
// 不弹选择器。macOS 的 loopback 不被 Chrome 支持，仍走 audiotee，因此只在 win32 注册。
const registerWindowsLoopbackHandler = () => {
  if (process.platform !== 'win32') return
  // 必须与主窗口同一 session（winMain/main.ts 的 persist:win-main），否则 handler 不会触发
  session.fromPartition('persist:win-main').setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      const primary = sources[0]
      if (primary) {
        callback({ video: primary, audio: 'loopback' })
      } else {
        callback({})
      }
    }).catch(() => callback({}))
  })
}
```

在默认导出函数的 `isInitialized = true` 之后插入一行调用（`mainHandle` 注册之前，不动其他任何行）：

```ts
export default () => {
  if (isInitialized) return
  isInitialized = true

  registerWindowsLoopbackHandler()
```

- [ ] **Step 2: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/main/modules/musicRecognition/index.ts
```
Expected: 无输出（0 errors）。

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npm run build
```
Expected: webpack 编译成功，无 TS 错误。

- [ ] **Step 3: Commit（先经用户确认）**

```bash
git add src/main/modules/musicRecognition/index.ts
git commit -m "feat(识曲): win32 注册系统音频 loopback 采集 handler"
```

---

### Task 2: 渲染进程新增 systemAudioCapture.ts，micCapture 导出重采样函数

**Files:**
- Create: `src/renderer/views/MusicRecognition/systemAudioCapture.ts`
- Modify: `src/renderer/views/MusicRecognition/micCapture.ts:22`（一处：给函数加 `export`）

**Interfaces:**
- Consumes: Task 1 注册的 display media handler（win32）。
- Produces（Task 3 依赖的精确签名）:
  - `startSystemAudioCapture(onProgress: (progress: number) => void): SystemAudioCaptureHandle`
  - `interface SystemAudioCaptureHandle { promise: Promise<Uint8Array>, stop: () => void }`
  - 错误类 `SystemAudioCancelledError` / `SystemAudioUnavailableError` / `SystemNoAudioError`
  - `micCapture.ts` 新导出 `resampleTo16kInt16(samples: Float32Array, sourceRate: number): Uint8Array`

- [ ] **Step 1: 修改 `src/renderer/views/MusicRecognition/micCapture.ts`**

第 22 行：

```ts
const resampleTo16kInt16 = (samples: Float32Array, sourceRate: number): Uint8Array => {
```

改为：

```ts
export const resampleTo16kInt16 = (samples: Float32Array, sourceRate: number): Uint8Array => {
```

- [ ] **Step 2: 创建 `src/renderer/views/MusicRecognition/systemAudioCapture.ts`**

完整文件内容：

```ts
// Windows 系统音频采集：getDisplayMedia(loopback) -> AudioContext -> 16kHz 单声道 Int16 PCM
// 产出的 PCM 与麦克风采集同格式，经 IPC 交给主进程走相同的 Shazam/ACRCloud 识别流程。
// 依赖主进程在 win32 下注册的 setDisplayMediaRequestHandler（audio: 'loopback'）。

import { resampleTo16kInt16 } from './micCapture'

const TARGET_SECONDS = 12
// 与主进程 capture.ts 的 hasAudibleSignal 阈值一致
const RMS_THRESHOLD = 32

export class SystemAudioCancelledError extends Error {
  constructor() {
    super('system audio capture cancelled')
    this.name = 'SystemAudioCancelledError'
  }
}

export class SystemAudioUnavailableError extends Error {}
export class SystemNoAudioError extends Error {}

export interface SystemAudioCaptureHandle {
  promise: Promise<Uint8Array>
  stop: () => void
}

const hasAudibleSignal = (pcm: Uint8Array): boolean => {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / Math.max(samples.length, 1)) >= RMS_THRESHOLD
}

export const startSystemAudioCapture = (onProgress: (progress: number) => void): SystemAudioCaptureHandle => {
  let cancel: (() => void) | null = null
  let stopRequested = false

  const promise = (async(): Promise<Uint8Array> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new SystemAudioUnavailableError('当前环境不支持系统音频采集')
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (err) {
      throw new SystemAudioUnavailableError(err instanceof Error ? err.message : '无法采集系统音频')
    }

    const stopAllTracks = () => {
      for (const track of stream.getTracks()) track.stop()
    }

    if (stopRequested) {
      stopAllTracks()
      throw new SystemAudioCancelledError()
    }

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stopAllTracks()
      throw new SystemAudioUnavailableError('无法采集系统音频（未检测到系统播放设备）')
    }
    // 只留音轨：视频轨立即停掉并移除
    for (const track of stream.getVideoTracks()) {
      track.stop()
      stream.removeTrack(track)
    }

    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    const targetSamples = TARGET_SECONDS * audioContext.sampleRate
    let totalSamples = 0
    let finished = false
    let cancelled = false
    let resolveDone: (() => void) | null = null
    const done = new Promise<void>(resolve => {
      resolveDone = resolve
    })

    const finish = () => {
      if (finished) return
      finished = true
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      stopAllTracks()
      void audioContext.close()
      resolveDone?.()
    }

    cancel = () => {
      cancelled = true
      finish()
    }

    // 系统停止播放或共享中断时音轨会 ended，提前收尾而不是干等
    audioTracks[0].addEventListener('ended', finish)

    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(input))
      totalSamples += input.length
      onProgress(Math.min(totalSamples / targetSamples, 1))
      if (totalSamples >= targetSamples) finish()
    }

    source.connect(processor)
    // ScriptProcessorNode 需要接入输出才会持续触发 onaudioprocess
    processor.connect(audioContext.destination)

    await done
    if (cancelled) throw new SystemAudioCancelledError()

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalLength === 0) throw new SystemAudioCancelledError()
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    const pcm = resampleTo16kInt16(merged, audioContext.sampleRate)
    if (!hasAudibleSignal(pcm)) {
      throw new SystemNoAudioError('未采集到系统声音，请确认正在播放歌曲')
    }
    return pcm
  })()

  return {
    promise,
    stop: () => {
      stopRequested = true
      cancel?.()
    },
  }
}
```

- [ ] **Step 3: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/renderer/views/MusicRecognition/systemAudioCapture.ts src/renderer/views/MusicRecognition/micCapture.ts
```
Expected: 无输出。

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npm run build
```
Expected: 编译成功。

- [ ] **Step 4: Commit（先经用户确认）**

```bash
git add src/renderer/views/MusicRecognition/systemAudioCapture.ts src/renderer/views/MusicRecognition/micCapture.ts
git commit -m "feat(识曲): 新增渲染进程系统音频 loopback 采集模块"
```

---

### Task 3: store 增加 startSystemRecognition，view 接线

**Files:**
- Modify: `src/renderer/store/musicRecognition.ts`
- Modify: `src/renderer/views/MusicRecognition/index.vue`（`handleStart` 与 script 顶部的 store 导入）

**Interfaces:**
- Consumes: Task 2 的 `startSystemAudioCapture`、三个错误类、`SystemAudioCaptureHandle`；`@common/utils` 的 `isWin`/`isMac`（`src/common/utils/index.ts:16-17`）；现有 `startRecognition`、`recognizeMusicFromMic`。
- Produces: `startSystemRecognition(): Promise<void>`（store 导出，view 的 `handleStart` 依赖）。

- [ ] **Step 1: 修改 `src/renderer/store/musicRecognition.ts`**

在文件顶部导入区追加：

```ts
import { isMac, isWin } from '@common/utils'
import {
  SystemAudioCancelledError,
  SystemAudioUnavailableError,
  SystemNoAudioError,
  startSystemAudioCapture,
  type SystemAudioCaptureHandle,
} from '@renderer/views/MusicRecognition/systemAudioCapture'
```

在 `let micCaptureHandle: MicCaptureHandle | null = null`（第 47 行）之后新增一行：

```ts
let systemCaptureHandle: SystemAudioCaptureHandle | null = null
```

在 `startMicRecognition` 函数之后新增：

```ts
// 系统音频识别按平台分流：macOS 走主进程 audiotee，Windows 走渲染进程 loopback，
// 其他平台（Linux）不支持系统音频采集，直接落到 unsupported 状态
export const startSystemRecognition = async() => {
  if (isMac) return startRecognition()
  if (!isWin) {
    Object.assign(musicRecognition, { status: 'unsupported' })
    return
  }
  if (isBusyStatus(musicRecognition.status)) return
  Object.assign(musicRecognition, { status: 'requestingPermission', error: undefined, result: undefined, alternatives: undefined, captureProgress: 0 })
  const handle = startSystemAudioCapture(progress => {
    Object.assign(musicRecognition, { status: 'capturing', captureProgress: progress })
  })
  systemCaptureHandle = handle
  try {
    const pcm = await handle.promise
    applySnapshot(await recognizeMusicFromMic(pcm))
  } catch (err) {
    if (err instanceof SystemAudioCancelledError) {
      Object.assign(musicRecognition, { status: 'idle', error: undefined, captureProgress: undefined })
      return
    }
    if (err instanceof SystemNoAudioError) {
      Object.assign(musicRecognition, { status: 'noAudio', error: err.message, captureProgress: undefined })
      return
    }
    Object.assign(musicRecognition, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      captureProgress: undefined,
    })
  } finally {
    systemCaptureHandle = null
  }
}
```

把 `stopRecognition` 改为同时停系统采集：

```ts
export const stopRecognition = async() => {
  micCaptureHandle?.stop()
  micCaptureHandle = null
  systemCaptureHandle?.stop()
  systemCaptureHandle = null
  await stopMusicRecognition()
}
```

- [ ] **Step 2: 修改 `src/renderer/views/MusicRecognition/index.vue`**

`handleStart`（约 218-224 行）由：

```ts
const handleStart = () => {
  if (source.value === 'mic') {
    void startMicRecognition()
  } else {
    void startRecognition()
  }
}
```

改为：

```ts
const handleStart = () => {
  if (source.value === 'mic') {
    void startMicRecognition()
  } else {
    void startSystemRecognition()
  }
}
```

同时把 script 里 store 导入中的 `startRecognition` 替换为 `startSystemRecognition`（view 内只有 `handleStart` 用到它；替换后确认文件里不再有 `startRecognition` 引用）。

- [ ] **Step 3: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/renderer/store/musicRecognition.ts src/renderer/views/MusicRecognition/index.vue && npm run build
```
Expected: eslint 无输出；webpack 编译成功。

- [ ] **Step 4: Commit（先经用户确认）**

```bash
git add src/renderer/store/musicRecognition.ts src/renderer/views/MusicRecognition/index.vue
git commit -m "feat(识曲): 系统音频识别按平台分流，Windows 走 loopback 采集"
```

---

### Task 4: 主进程可用性判断拆分（win32 初始状态不再 unsupported）

**Files:**
- Modify: `src/main/modules/musicRecognition/service.ts:14-18`

**Interfaces:**
- Consumes: 无。
- Produces: win32 下 `getSnapshot()` 初始 `status` 为 `'idle'`；`startRecognition`（audiotee 路径）仍只在 darwin 14.2+ 放行（Task 3 保证 win32 不会调到它）。

- [ ] **Step 1: 修改 `src/main/modules/musicRecognition/service.ts`**

第 14-18 行：

```ts
let recognitionController: AbortController | null = null
let snapshot: LX.MusicRecognition.Snapshot = {
  status: isMusicRecognitionSupported() ? 'idle' : 'unsupported',
  history: [],
}
```

改为：

```ts
let recognitionController: AbortController | null = null
// 「识曲功能是否可用」（决定 UI 初始状态）：macOS 14.2+ 走 audiotee，Windows 走渲染进程 loopback。
// 注意与 isMusicRecognitionSupported 区分：后者是「主进程能否采集」，仅作 audiotee 路径的门。
const canUseMusicRecognition = (): boolean => isMusicRecognitionSupported() || process.platform === 'win32'
let snapshot: LX.MusicRecognition.Snapshot = {
  status: canUseMusicRecognition() ? 'idle' : 'unsupported',
  history: [],
}
```

`startRecognition` 里的 `if (!isMusicRecognitionSupported())`（约 86 行）**保持不变**。

- [ ] **Step 2: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/main/modules/musicRecognition/service.ts && npm run build
```
Expected: 无 lint 输出；编译成功。

- [ ] **Step 3: Commit（先经用户确认）**

```bash
git add src/main/modules/musicRecognition/service.ts
git commit -m "feat(识曲): win32 下识曲功能状态默认可用"
```

---

### Task 5: 放开导航入口的 isMac 门控

**Files:**
- Modify: `src/renderer/components/layout/Aside/NavBar.vue:75`（及第 20 行附近的 `isMac` 导入，若不再使用）

**Interfaces:**
- Consumes: 无。
- Produces: Windows/Linux 上侧边栏出现「听歌识曲」入口（路由 `/musicRecognition` 本来就全平台注册，`src/renderer/router.ts:50-54`）。

- [ ] **Step 1: 修改 `src/renderer/components/layout/Aside/NavBar.vue`**

MusicRecognition 菜单项（约 68-76 行）中的：

```ts
          name: 'MusicRecognition',
          enable: isMac,
```

改为：

```ts
          name: 'MusicRecognition',
          enable: true,
```

然后检查该文件内 `isMac` 是否还有其他使用：

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && grep -n "isMac" src/renderer/components/layout/Aside/NavBar.vue
```
Expected: 只剩 import 那一行。若是，则从 `@common/utils` 的导入语句中删掉 `isMac`（注意保留同一 import 里的其他符号；若整行只有 `isMac` 则删整行）。

- [ ] **Step 2: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/renderer/components/layout/Aside/NavBar.vue && npm run build
```
Expected: 无 lint 输出（特别确认没有 unused import 报错）；编译成功。

- [ ] **Step 3: Commit（先经用户确认）**

```bash
git add src/renderer/components/layout/Aside/NavBar.vue
git commit -m "feat(识曲): 听歌识曲入口全平台开放"
```

---

### Task 6: mac 回归冒烟 + 整体收尾

**Files:**
- 无文件改动。

- [ ] **Step 1: 全量 lint 与构建**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npm run lint && npm run build
```
Expected: lint 通过（允许仓库既有的 warning，不允许新增 error）；构建成功。

- [ ] **Step 2: mac 开发模式回归（audiotee 路径不受影响）**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npm run dev
```
手动验证：
1. 侧边栏「听歌识曲」入口仍在（mac）。
2. 用其他 App 放一首歌，选「系统音频」点开始 → 能识别出结果（audiotee 路径回归）。
3. 选「麦克风」点开始 → 麦克风模式正常。
4. 设置里播放引擎与账号功能无异常。

Expected: 全部正常。若识曲异常，优先排查 Task 4 是否误改了 `startRecognition` 的 darwin 门控。

- [ ] **Step 3: Windows 实机验收（用户执行，记录在案）**

CI 产出 Windows 包（见构建管线计划）后，在 Windows 上验证：
1. 侧边栏出现「听歌识曲」。
2. 「系统音频」模式：用浏览器/其他播放器放歌 → 识别成功。
3. 「系统音频」模式：系统静音/无播放时 → 提示「未采集到系统声音，请确认正在播放歌曲」。
4. 「麦克风」模式正常。
5. 采集中点「停止识别」→ 回到待识别状态，无残留采集。

## Self-Review 记录

- Spec 覆盖：组件 1（handler）→ Task 1；组件 2（采集模块）→ Task 2；组件 3（store）+ 4（view）→ Task 3；组件 5（service 拆分）→ Task 4；组件 6（NavBar）→ Task 5；错误处理/验证 → Task 2/3/6。i18n 节按 Global Constraints 说明以代码惯例为准。
- 类型一致性：`startSystemAudioCapture`/`SystemAudioCaptureHandle`/三个错误类在 Task 2 定义、Task 3 消费，名字逐一核对一致；`resampleTo16kInt16` 签名两处一致。
- 无占位符：所有代码步骤含完整代码与命令。
