# LX Music 增强版 3.1.4-beta.4

本测试版修复 Apple Silicon 设备升级到 macOS 26/27 后，内置 MPV 被识别但无法播放、音频输出列表只显示“默认设备”的问题。

## macOS MPV 兼容性

- 修复 arm64 应用错误启动 x86_64 内置 MPV 导致的 `spawn Unknown system error -86`。
- Apple Silicon macOS 26/27 使用官方原生 arm64 MPV；macOS 15 继续使用原有兼容运行时，两个系统分支互不覆盖。
- 新系统缺少原生运行时时不再回落到不可执行的旧 MPV，可继续查找 Homebrew 或系统安装的 MPV。
- 恢复 MPV 音频设备枚举，可选择 USB 声卡、内置扬声器、Loopback 与聚合设备。
- arm64 安装包同时携带旧系统与新系统运行时，并在打包阶段校验完整性，缺失时终止构建。

## 安装与自动更新

- macOS arm64 构建从 MPV 官方滚动发布中自动获取当前 `macos-26-arm` 运行时，避免再次生成缺少新系统 MPV 的安装包。
- GitHub Release 新增 `latest-mac.yml` 与 DMG blockmap，自动更新元数据同时覆盖 x64 和 arm64 安装包。

## 验证

- 已在 Apple Silicon macOS 27 Beta 5 实测 MPV 0.41 启动、FLAC 播放与设备枚举。
- 已验证 macOS 15（Darwin 24）仍选择原有 `mpv.app`，macOS 27（Darwin 26）选择 `mpv-macos26.app`。

## 已知限制

- 本版本为测试版，建议安装前备份重要数据。
- 各音乐平台接口可能随官方策略变化；如遇异常，请在 GitHub Issues 附上系统版本、应用日志与复现步骤。
