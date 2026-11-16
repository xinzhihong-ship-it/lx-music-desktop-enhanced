# LX Music 增强版 3.3.3-beta.1（测试版）

在 3.3.2 的基础上新增「推送到 Folia 歌词舞台」：播放仍在本软件（音源、音质、MPV / 内置引擎与输出设备设置照常生效），正在播放的歌曲与歌词同步推送给 [Folia](https://github.com/chthollyphile/folia-major)，由 Folia 显示歌词动画。

## 推送到 Folia 歌词舞台

- 推送歌名、歌手、专辑、时长与封面（本地歌曲的内嵌封面也会上传）。
- 歌词原文、翻译、罗马音、逐字四轨全部推送，与本软件显示的一致；调整歌词偏移后 Folia 也随之更新。
- 播放、暂停、拖动、倍速、切歌实时同步；停止播放或关闭推送时，Folia 的舞台清空。
- 两边谁先打开都可以；Folia 重启、关闭再开启舞台模式、重新生成令牌后自动重连。
- Folia 的舞台被其他来源占用时不抢占，下一首歌开始时再推送。

### 使用方法

1. 本软件：「设置 → 开放 API → Folia 歌词舞台」，打开「把正在播放的歌曲推送到 Folia 的歌词舞台」。
2. Folia：「设置 → 连接与集成」，开启「舞台模式」，「舞台数据来源」选 Stage API。
3. 在 Folia 首页点「舞台」。本软件设置页显示「已连接 Folia（端口 …）」即表示连接成功。

### Folia 0.7.28 的已知问题

Folia 0.7.28 的舞台模式对外部播放器推送的歌词只更新翻译与进度，**原文大字与逐字动画不显示**（Folia 自身的缺陷，所有通过 Stage API 推送歌词的播放器都受影响）。在 Folia 官方修复之前，macOS 上可以用补丁脚本补上，脚本只改动这一处，可随时还原：

```bash
curl -fsSL -o ~/Downloads/folia-stage-fix-macos.sh https://raw.githubusercontent.com/xinzhihong-ship-it/lx-music-desktop-enhanced/beta/scripts/folia-stage-fix-macos.sh
bash ~/Downloads/folia-stage-fix-macos.sh          # 补上
bash ~/Downloads/folia-stage-fix-macos.sh restore  # 还原
```

覆盖安装沿用原有配置。这是测试版，欢迎反馈问题。
