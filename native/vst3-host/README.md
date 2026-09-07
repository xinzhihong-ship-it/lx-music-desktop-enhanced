# LX VST3 开发状态

当前已接入实验性 Electron AudioWorklet 通路，**mpv 尚未接入，不能作为完整 VST3 音频模式发布**。

已实现：

- 设置页选择、保存、移除多个插件目录；同时扫描系统目录，缺失路径返回警告并保留设置。
- 每个插件在独立进程探测；加载失败或崩溃不会终止 Electron。
- 本机 TCP 会话校验、请求大小上限、串行请求、超时销毁和退出错误传播。
- 立体声插件加载/卸载、参数读取/修改、状态保存/恢复、PCM 块处理及每次处理后的延迟样本数。
- 同一插件实例的原生编辑器打开/关闭。编辑器嵌入宿主自己的原生窗口，**尚未嵌入 Electron 窗口**。
- 设置页插件链的启用、禁用、排序和编辑器入口；按实例保存状态，排序时在单宿主内重建链但保留各实例状态，加载失败保留原链，崩溃后重新配置可恢复最近一次保存的状态。
- 插件 DSP 在宿主内运行于专用音频线程，主线程只负责协议、界面事件和宿主服务：原生菜单模态循环、预设加载等 UI 操作不再阻塞音频处理，实时调节不被打断。
- Electron 512 帧音频块、2048 帧固定桥接缓冲；一个宿主进程管理整个插件链，一次 PCM 请求顺序处理全部插件。过期音频块不再排队追赶：主进程只保留一个正在处理块和一个最新待处理块，被替代的块立即返回直通干声（面板显示"临时直通"提示），恢复后无缝回到处理状态；仅协议数据损坏或宿主崩溃/断开才暂停播放。
- 插件延迟和桥接延迟单独显示，插件链中每个插件的独立延迟在其条目上单独显示，主窗口/桌面歌词共用补偿时间，保留原有用户偏移；视频和 Audirvana 不应用该补偿。
- 播放详情控制栏新增独立的音效插件管理面板（播放详情按钮排的拼图图标入口），视觉与播放队列面板同构：插件链列表开关、"全部开启/关闭"批量操作、插件参数界面入口；扫描与添加在独立的插件选择器中完成（搜索过滤 + 虚拟滚动，支持大量插件，添加后默认启用并立即生效），设置页与面板共用同一选择器；设置页保留插件目录等高级配置。

尚需实现：

- 带背压、暂停/seek 清空和输出时钟的 mpv PCM 桥接。
- 音频输出设备、硬件输出延迟、已知非零及动态延迟插件的歌词同步实测。
- VST 模式下临时停用 bit-perfect、退出后恢复，以及 Audirvana 排除逻辑。

## 平台支持状态

| 平台 | 音频处理 | 插件编辑器 | 状态 |
| --- | --- | --- | --- |
| macOS arm64 | ✅ 实测 | ✅ 实测（含置前激活） | 可用 |
| macOS x64 | 同代码路径 | 同代码路径 | 原生 CI 构建，待实机验证 |
| Windows x64 | 就绪，待实测 | 可打开，但后台进程窗口可能被前台窗口遮挡（任务栏点开即可） | 原生 CI 构建，待实机验证 |
| Linux x64 | 就绪，待实测 | X11 编辑器交互待实测 | 原生 CI 构建，待实机验证 |
| Linux arm64 | 交叉构建 | 交叉构建 | CI 使用 aarch64 sysroot，待 ARM 真机验证 |
| Linux armv7l | 交叉构建 | 交叉构建 | CI 使用 armhf sysroot，待 ARM 真机验证 |
| Windows arm64 | 交叉构建 | 交叉构建 | CI 使用 MSVC ARM64 工具链，待 ARM 真机验证 |
| Windows 7 x86/x64 | 当前包不携带宿主 | 当前包不携带宿主 | Electron 22 兼容包禁用 VST3 |

CI 工作流 `vst3-check` 在 Ubuntu、Windows、macOS 原生 runner 执行 host 构建及 Rust/单元测试，并额外构建 Windows ARM64、Linux ARM64 和 Linux ARMv7l host；音频端到端测试仅在 macOS/Windows 运行，Linux 实时音频与 X11 编辑器仍待实机验证。Windows x86、Windows 7 兼容包仍明确省略 VST3 宿主。

打包已接入：`beforePack` 阶段用 Rust 构建宿主（要求构建机装有 Rust 和目标链接器），二进制经 `extraResources` 放入 `resources/bin/`；Windows/Linux ARM 目标使用对应交叉 target 和 sysroot，构建失败会直接阻止对应包，未支持的目标会删除旧 host 并明确省略，避免误用其他架构二进制。打包后和运行时都会校验宿主文件格式、可执行权限及原生架构，开发模式也不会启动不匹配的 stale host。

另外，音频线程直写响应的协议安全性依赖客户端"同一时刻至多一个在途请求"的约定（chain.cjs 已保证）；Linux 编辑器还依赖库的 X11 事件服务，真机表现需实测确认。

本机已使用 macOS arm64 SonoBus 验证探测、加载、参数读取、512 帧立体声处理、状态往返、排序、崩溃恢复和原生窗口打开/关闭，另验证了带辅助总线的插件（Acon Digital Remix 分轨输出）。Windows/Linux 目前仅验证目录规则，未在对应系统运行宿主；未验证已知非零延迟插件或实际播放听感。

当前 Electron 主进程仍使用结构化克隆传递 512 帧 Float32Array，宿主端使用二进制平面 PCM；完整插件链在一个宿主音频线程内处理，控制线程负责编辑器和宿主服务。最新音频块合并已避免积压追赶，但重型插件链、编辑器交互、ARM 真机和长期播放仍需实测验收。

## 构建与检查

在仓库根目录运行（需要 Rust 1.85 或更高版本；Linux 需要 XCB 开发库）：

```sh
npm run build:native:vst3
npm run test:vst3
npm run test:vst3:audio
```

构建脚本只构建当前操作系统/架构，产物为 `build/Release/lx-vst3-host`（Windows 为 `.exe`）。设置页开发运行也可以使用 `cargo build` 生成的 debug 产物。发布打包会在 beforePack 阶段自动构建并携带宿主（见平台支持状态）。当前仅使用构建机原生的 Rust target：Windows x64 为 `x86_64-pc-windows-msvc`，macOS x64/arm64 为对应 Apple target，Linux x64 为 `x86_64-unknown-linux-gnu`；Windows ARM64、Linux ARM64/ARMv7l 需要后续补齐对应 Rust target、Windows MSVC/ARM 工具链或 Linux ARM XCB sysroot 后，才可重新标记为支持。

可选真实插件检查，不会输出插件状态内容，也不会改写插件文件：

```sh
LX_VST3_TEST_PLUGIN=/absolute/path/Effect.vst3 npm run test:vst3
```

同时设置 `LX_VST3_TEST_EDITOR=1` 可运行原生编辑器打开/关闭检查。

`test:vst3:audio` 使用隐藏 Electron 窗口、真实 AudioContext、IPC 和原生插件链，输出端静音，不播放到扬声器。设置 `LX_VST3_TEST_PLUGIN` 可将同一测试用于真实插件。工作线程测试覆盖固定缓冲、环绕、旧批次丢弃及准备播放的取消竞态。

本机已使用 macOS arm64 SonoBus 验证探测、加载、参数读取、512 帧立体声处理、状态往返、排序、崩溃恢复和原生窗口打开/关闭。Windows/Linux 目前仅验证目录规则，未在对应系统运行宿主；未验证已知非零延迟插件或实际播放听感。

宿主依赖固定到 Cargo.toml 中的 Git 提交，并提交 Cargo.lock。依赖来源：<https://github.com/HelgeSverre/rust-vst3-host>（MIT）。Windows ARM64 和 Linux ARM 构建由根目录打包脚本设置目标链接器；Linux 还需要对应架构的 `libxcb` 开发包。
