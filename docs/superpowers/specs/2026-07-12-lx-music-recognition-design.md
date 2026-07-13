# 洛雪音乐听歌识曲设计规格

> **目标：** 在 macOS 版 LX Music 中采集电脑正在播放的系统音频，识别曲名与歌手，并允许用户继续搜索、播放或加入歌单。

## 1. 产品入口

### 1.1 左侧导航

在左侧导航中新增「听歌识曲」，位置放在：

```text
平台音乐
听歌识曲
我的列表
```

选择这里的原因：

- 听歌识曲是独立工具，不属于当前播放器的播放引擎能力。
- 识别结果需要保留历史记录和后续操作，独立页面比底部播放栏弹窗更合适。
- 它与「平台音乐」「我的列表」存在自然工作流：识别歌曲后搜索对应平台，再加入歌单。

导航使用与现有图标风格一致的音频波形/扫描图标，不在底部播放控制区增加常驻按钮。

### 1.2 页面布局

路由：`/musicRecognition`

页面采用一个主操作区和一个结果列表，不使用嵌套卡片：

- 顶部工具栏：开始/停止识别、音频来源状态、清空本地历史。
- 当前状态区：空闲、请求权限、监听中、识别中、已识别、未识别、错误。
- 历史列表：封面、歌曲名、歌手、识别时间、匹配置信息和操作菜单。
- 结果操作：在洛雪搜索、播放、添加到歌单、复制歌曲信息。

连续识别默认关闭。首期由用户点击开始，采集 8-12 秒后执行一次识别；连续模式作为后续设置项。

## 2. 技术选型

### 2.1 macOS 系统音频采集

首选 `AudioTee.js`：

- 使用 macOS Core Audio Taps，要求 macOS 14.2+。
- Node.js EventEmitter 接口可在 Electron 主进程中直接消费 PCM 数据。
- 支持全系统或指定进程采集。
- MIT 许可证，适合随 Electron 应用打包。

macOS 14.2 以下首期明确提示不支持，不自动安装 BlackHole。BlackHole 兼容方案放到后续版本，避免首期引入驱动安装、音频路由和卸载风险。

### 2.2 歌曲识别

首期使用 SongRec 的 Shazam 指纹实现，封装为独立 CLI/本地辅助进程：

- 输入：16 kHz、单声道、16-bit PCM/WAV，建议 8-12 秒。
- 输出：结构化 JSON，包括歌曲名、歌手、专辑、封面、Shazam 标识和置信信息。
- 主应用不直接依赖 Python。

SongRec 为 GPL-3.0，且调用逆向实现的 Shazam 在线服务。正式打包前必须确认许可证分发义务，并接受服务接口可能失效的风险。

若不接受该风险，替代方案为官方 ShazamKit 或商业 AudD/ACRCloud；这三者不属于完全开源识别后端。

## 3. 模块边界

```text
src
├── common
│   └── types
│       └── musicRecognition.d.ts
├── main
│   └── modules
│       └── musicRecognition
│           ├── index.ts
│           ├── capture.ts
│           ├── recognizer.ts
│           └── historyStore.ts
└── renderer
    ├── store
    │   └── musicRecognition.ts
    └── views
        └── MusicRecognition
            ├── index.vue
            └── components
                ├── RecognitionStatus.vue
                └── RecognitionHistory.vue

resources
└── music-recognition
    └── darwin-arm64
        ├── audiotee
        └── songrec-cli
```

### 3.1 Common

`src/common/types/musicRecognition.d.ts` 定义：

```typescript
type RecognitionStatus =
  | 'idle'
  | 'requestingPermission'
  | 'capturing'
  | 'recognizing'
  | 'matched'
  | 'notMatched'
  | 'error'

interface RecognitionResult {
  id: string
  title: string
  artist: string
  album?: string
  coverUrl?: string
  recognizedAt: number
  provider: 'shazam'
  providerTrackId?: string
}
```

IPC 名称统一加入 `src/common/ipcNames.ts`，不使用散落字符串：

- `musicRecognition_start`
- `musicRecognition_stop`
- `musicRecognition_status`
- `musicRecognition_result`
- `musicRecognition_getHistory`
- `musicRecognition_clearHistory`

### 3.2 Main

主进程负责所有有系统权限和子进程生命周期的操作：

- `capture.ts`：启动 AudioTee，采集 PCM，达到目标时长后停止。
- `recognizer.ts`：把 PCM 封装为 WAV，调用识别辅助程序，解析 JSON。
- `historyStore.ts`：只保存脱敏识别结果，不保存原始录音。
- `index.ts`：注册 IPC，确保同时只能存在一个识别任务。

应用退出、窗口重启或用户点击停止时，必须终止 AudioTee 与识别子进程并删除临时音频。

### 3.3 Renderer

渲染进程只管理 UI 状态：

- `store/musicRecognition.ts` 保存当前状态、错误和历史结果。
- `views/MusicRecognition/index.vue` 发起开始/停止请求并订阅事件。
- 识别结果通过现有搜索路由查找各音乐平台对应歌曲，不直接制造新的播放 URL 接口。
- 添加到歌单复用现有 `ListAddModal`，平台歌曲操作复用已经存在的平台歌单能力。

## 4. 导航与路由改动

涉及文件：

- `src/renderer/components/layout/Aside/NavBar.vue`
- `src/renderer/router.ts`
- `src/renderer/components/layout/Icons.vue`
- `src/lang/zh-cn.json`
- `src/lang/zh-tw.json`
- `src/lang/en-us.json`

路由名称统一使用 `MusicRecognition`。图标必须与当前左侧导航的线宽、视觉尺寸和 `viewBox` 对齐。

## 5. 权限与隐私

- macOS 首次使用时由 tap 启动自动触发「系统音频录制」授权弹窗（`NSAudioCaptureUsageDescription`）。
- 注意区分两个权限：Core Audio Tap 采集**本应用进程树**的音频无需授权；采集**其他应用**的音频必须有「系统音频录制」授权（系统设置 → 隐私与安全性 → 录屏与系统录音）。该授权被拒绝后 tap 不报错，只输出全静音，因此采集结果为静音时必须引导用户前往系统设置开启，授权后重试即可（audiotee 每次采集都是新进程，无需重启应用）。
- 不要使用 `desktopCapturer.getSources` 触发屏幕录制授权——那是另一个权限，与系统音频采集无关。
- 麦克风音源使用渲染进程 `getUserMedia`，依赖 `NSMicrophoneUsageDescription` 与 `com.apple.security.device.audio-input` entitlement；Mac mini 等设备没有内置麦克风，默认输入设备（如 USB 声卡）无输入信号时采集结果为静音。
- `Info.plist` 增加 `NSAudioCaptureUsageDescription` 与 `NSMicrophoneUsageDescription`。
- 页面状态必须能区分权限拒绝、当前无音频、网络失败和未匹配。
- 原始 PCM/WAV 只写临时目录，识别结束后立即删除。
- 默认不持续监听，不在后台自动启动。
- 不上传历史记录；发送给识别服务的只有当前识别片段所生成的指纹/请求数据。

## 6. 二进制与打包

沿用现有 MPV 的资源模式：

- 开发环境从 `resources/music-recognition/<platform>-<arch>/` 读取。
- 生产环境从 `process.resourcesPath/bin/music-recognition/` 读取。
- `build-config/build-pack.js` 通过 `extraResources` 复制二进制。
- 打包前校验文件存在且可执行，不在运行时静默下载二进制。
- macOS arm64 首期优先；x64 和 Windows/Linux 在各自二进制与采集实现完成后再开放入口。

## 7. 识别流程

```text
用户点击开始
  -> 检查平台与权限
  -> 启动 AudioTee.js
  -> 采集 8-12 秒 PCM
  -> 停止采集
  -> 生成临时 WAV
  -> SongRec/Shazam 识别
  -> 删除临时文件
  -> 返回并保存结果
  -> 用户搜索、播放或加入歌单
```

重复点击开始不能创建并发任务。停止操作必须可中断采集和识别请求。

## 8. 分阶段实施

### Phase 1：可行性原型

- 在命令行用 AudioTee.js 获取 10 秒系统音频。
- 验证生成的 WAV 可播放且不是静音。
- 使用 SongRec CLI 对至少 5 首不同来源歌曲识别。
- 记录成功率、平均耗时和权限行为。

原型未达到 4/5 成功率前，不进入正式 UI 实现。

### Phase 2：主进程能力

- 增加类型、IPC、采集控制器、识别控制器和临时文件清理。
- 增加超时、取消、并发保护与进程退出清理。
- 为状态机和 JSON 解析增加测试。

### Phase 3：页面与工作流

- 新增左侧入口、路由、页面和识别历史。
- 接通搜索、播放、添加到本地/平台歌单。
- 完成无权限、无声音、未匹配、网络错误状态。

### Phase 4：打包验证

- 验证 arm64 开发包和签名后的安装包。
- 验证首次权限、拒绝后恢复、连续启动/停止、应用退出清理。
- 检查二进制签名、许可证文件与隐私说明。

## 9. 验收标准

- macOS 14.2+ 能捕获扬声器/耳机正在播放的系统音频。
- 单次识别在正常网络下 20 秒内返回结果或明确错误。
- 同一时间只有一个采集/识别任务。
- 停止识别后无残留子进程和临时音频。
- 识别结果可在洛雪内搜索，并可加入现有歌单。
- 权限拒绝不会导致白屏、卡死或无限重试。
- 连续执行 30 次识别后主进程与 renderer 内存无持续增长。
- ESLint、主进程构建、renderer 构建和打包检查通过。

## 10. 首期边界

- 仅支持 macOS 14.2+、arm64。
- 仅支持用户主动发起的单次识别。
- 音源支持系统音频（Core Audio Tap）与麦克风（渲染进程 getUserMedia 采集 8 秒，重采样为 16kHz 单声道 PCM 后走同一识别流程）；不安装虚拟声卡。
- 不自动播放识别结果。
- 不上传或长期保存原始音频。
- Windows WASAPI loopback、Linux PipeWire/PulseAudio 和连续监听后续实现。
