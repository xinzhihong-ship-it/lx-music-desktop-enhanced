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
- 8 组真实 Electron 交互检查通过：启动与浅色主题、深色主题与 IPC 保存、键盘设置开关、真实数据库的 400 首歌列表及滚动到底、全部启用的主导航页面、标签箭头键与焦点、828px 窗口下三种进度条布局、既有主题兼容。

当前验证证据与截图见工作区 `临时/easyui-*.log` 及本仓库 `build/ui-review/`。本分支的交互验证不代表已经在 Windows、Windows 7 与 Linux 真机完成验收。
