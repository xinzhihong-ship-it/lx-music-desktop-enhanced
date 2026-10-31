# EasyUI 风格界面重构

本分支基于 `3.2.6` 正式版，使用现有 Vue 3、Less、Vue Router 与 Electron 实现。设计参考 [EasyUI](https://www.easyui.site/) 的圆角、胶囊导航、轻动效和中性色层次。未引入 React、Tailwind 或 Framer Motion 运行时依赖。

## 已实现

- 应用框架：文字与图标侧栏、品牌区、全局搜索、独立内容面板、横跨窗口的底部播放器。
- 响应式：宽窗口显示导航文字；980px 以下收起为图标，覆盖现有最小 828px 窗口。
- 播放器：mini、middle、full 三种进度条布局共用同一视觉规范；上一首、播放／暂停、下一首改用原生按钮，保留原播放处理函数、音质、基调、音量、桌面歌词和队列入口。
- 搜索首页：欢迎面板、原创 CSS 唱片图形和连接真实功能的列表、平台音乐、听歌识曲快捷入口；保留搜索历史与热搜设置。
- 公共组件：按钮、输入框、单选／多选、带标签的布尔开关、胶囊标签、下拉框、分页、上下文菜单和弹窗。
- 页面：设置、平台音乐、排行榜、听歌识曲、播放详情使用统一的表面、边框、圆角和间距；共享表格规则覆盖搜索结果、本地列表与下载列表。
- 无障碍：可见键盘焦点；标签支持左右箭头、Home、End；布尔开关支持键盘操作，禁用控件不参与 Tab 顺序；尊重系统减少动态效果设置与软件动画开关。
- 主题：新增 Easy · 晨光与 Easy · 夜色；新安装使用这组默认主题，已有用户的主题配置继续保留。工具栏切换使用现有配置的浅色与深色主题。
- 主题兼容：主进程主题选择使用 `LX.Theme` 类型；主题变化事件应用用户实际选择，自动主题仍跟随系统。
- 文案：新增界面文案与主题名称覆盖简体中文、繁体中文、英文。

## 关键约束

虚拟列表的行高与定位继续由列表组件管理，样式不另设行高。窗口拖动区、左右窗口按钮、播放与账号 IPC、歌单读写接口继续使用原有实现。

视觉令牌位于 `src/renderer/assets/styles/ui-tokens.less`，从现有主题颜色派生；新增样式使用 Electron 22 支持的 CSS，兼顾 Windows 7。

EasyUI 上游是 MIT 许可证的 React 组件项目。本次参考了其公开设计与交互方式，界面代码按现有 Vue 结构实现。后续若直接移植上游代码，应随代码保留其 MIT 版权与许可声明。上游仓库：https://github.com/Surajmaurya1/easyui 。

## 运行与验证

```sh
npm run build
npm run preview:ui
npm run test:ui
npm run lint
npm run test:playback-recovery
npm run test:issue22
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/syncCompatibility.test.mjs
```

`preview:ui` 使用系统临时目录下的 `lx-music-easyui-preview` 资料目录，不读取原安装的歌单与账号，也不注册系统 `lxmusic:` 默认处理程序。`test:ui` 使用另一个独立的 `lx-music-easyui-test` 目录，写入测试设置、400 首带本地静音素材的验证曲目，并跳过初次运行提示。截图和交互验证结果写入 `build/ui-review/`。

在 macOS 网络卷上运行 Electron 可能遇到 Framework／ICU 资源加载错误（[上游 issue #42624](https://github.com/electron/electron/issues/42624)）。应将 Electron 运行时放在本地磁盘，再加载本项目；无需修改业务代码。

## 已完成的验证

- 主进程、主界面、桌面歌词、音源脚本四项生产构建通过；最后的主题与布局修正已完成主界面重建。
- 全量源码 ESLint、主进程 TypeScript 检查与新增预览／验证脚本的 ESLint 通过。
- 115 项播放与音质、60 项歌单、2 项同步兼容测试通过。
- 17 组真实 Electron 交互检查通过：原有主题、键盘、导航、400 首歌及最小窗口检查，加上歌单控件对齐、详情返回与前进、搜索条件保留、两种搜索行布局的歌名双击播放、歌手／专辑搜索兼容性，以及真实设备目录的双向引擎切换与选择记忆。

当前验证证据与截图见工作区 `临时/easyui-*.log` 及本仓库 `build/ui-review/`。本分支的交互验证不代表已经在 Windows、Windows 7 与 Linux 真机完成验收。

## 内置与 MPV 输出设备选择

Chromium 的 Web Audio 设备 ID 由原生标识结合来源与盐值生成，MPV 使用音频后端及原生设备标识，两者不能直接通用。实现读取当前电脑的设备列表并保存两端对应关系，不包含固定设备名称、列表序号或设备型号映射。

先验证已保存的 ID 与设备描述是否一致；需要重新识别时，只有两端名称都唯一才建立新对应。完整名称优先于移除 Chromium 传输类型后缀的名称；同名设备不按列表顺序猜选。macOS 的 CoreAudio 与 AVFoundation 可以比较同一 UID；ALSA、Pulse、PipeWire 等可能变化的标识不当作稳定硬件身份。Windows 通信输出用当前 Chromium 设备分组定位硬件，系统默认输出继续使用各引擎的默认角色。

设备管理服务在应用启动时创建，设置界面共用该服务；播放前验证所选目标。设备缺失、重名或已保存 ID 被其他硬件复用时保留原选择并显示暂不可用，不静默改成默认或其他设备。设置使用现有持久化层支持的字符串字段，重启后保留两端 ID 与两套引擎各自的设备描述。

70 项设备与路由测试通过，覆盖跨电脑配置、ID 复用、设备索引重排、重名、不同音频后端、默认／通信角色、异步竞态、独立引擎名称与重启保存。Mac 完整应用验证使用当前运行时设备列表的两项输出；内置和 MPV 均通过同一静音 WAV 的真实播放事件检查，另验证重启后设备、设置和 400 首歌数据库保留。Windows/Linux 的后端格式通过模拟目录测试，未声称完成跨系统真机测试。

依据：[Chromium 设备 ID 源码](https://github.com/chromium/chromium/blob/main/content/public/browser/media_device_id.cc)、[MPV audio-device 文档](https://mpv.io/manual/master/#options-audio-device)、[Media Capture 设备标识规范](https://w3c.github.io/mediacapture-main/#dom-mediadeviceinfo-deviceid)。

## macOS 覆盖安装测试包

当前测试包为 `3.3.0-beta.3` ARM64 DMG，位于工作区 `临时/新版UI-Mac安装包/3.3.0-beta.3/`，同目录包含安装说明、SHA-256 和验证报告。

本版修复「打开歌单」与平台选择框错位、详情顶部返回被详情保留状态跳回，以及歌名文字点击搜索阻断双击播放的问题。歌名区域统一沿用行级双击播放，歌手与专辑的搜索入口继续保留。

生产包使用 `dist/main.js`，保留 `cn.toside.music.desktop` Bundle ID、`lx-music-desktop` 应用名称及 `lx-music-desktop-enhanced` 包名。运行时实测其默认资料目录为 `~/Library/Application Support/lx-music-desktop-enhanced`，与本机原安装一致。覆盖后保留原主题，Easy 配色可在设置中选择。

主进程与三个前端目标均重新生产构建；Electron 40.10.5、第三方依赖及原生运行库沿用本机已安装的 `3.3.0-beta.2` ARM64 应用，重新生成 ASAR 完整性信息与本地签名。64 个原生绑定／库在签名前逐一比对内容，仓库的 MPV 与 VST3 打包检查通过。

完整应用包在独立临时资料目录中完成 17 项界面验证，并验证旧格式配置保留、重启后音量设置与 400 首歌数据库重新加载。随包 MPV、FFmpeg、FFprobe 启动及本地 WAV 解码通过；内置与 MPV 的静音 WAV 实际播放通过。实体声卡听音、第三方登录及 VST3 插件处理尚未完整验收。

DMG 的文件系统校验及挂载后的应用签名严格检查通过。此包采用 ad-hoc 签名，未做苹果公证。当前发布页缺少 `latest-mac.yml`，应用内更新检查会失败，测试包使用手动覆盖安装。
