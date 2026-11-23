# LX Music 增强版 3.4.0

在 3.3.2 的基础上新增和 [Folia](https://github.com/chthollyphile/folia-major) 的配合，给喜欢 Folia 炫酷歌词动画的人用。

> **Folia 在这里只负责显示歌词动画和当遥控器，歌还是由本软件播放。** 音源、音质、MPV / 内置引擎、输出设备、VST3 都按本软件的设置走。不用 Folia 的话，这一版和 3.3.2 用起来一样。

## Folia 对接（配合 Folia 落雪对接版）

装上 [Folia 落雪对接版](https://github.com/xinzhihong-ship-it/folia-major/releases)，就能在 Folia 里：

- **搜歌、搜歌单**：用本软件的搜索，可以搜全部平台，也可以只搜一个。歌单按关键词各平台一起搜，名字下面写着是哪个平台的。在 Folia 里点播放，和在本软件搜索页双击一样：歌加进「试听列表」，从那里播放。
- **看我的列表和平台音乐的歌单**：
  - 试听列表、我的收藏和自建列表都在 Folia 的「歌单」里。Folia 里点红心就是加进「我的收藏」，「加入歌单」加进我的列表。
  - 「平台音乐」里登录的平台账号，它的每日推荐和歌单接在后面，名字前写着平台（如「某平台 · 我喜欢」）。在 Folia 里只能看和播放，加歌、删歌请在本软件里做。
- **打开分享的歌单**：本软件支持的各平台的歌单链接或 ID。在 Folia 的命令面板选「打开分享的歌单」，或者直接把链接贴进搜索框。打开后可以播放全部，也可以收藏成我的列表。
- **两边同步控制播放**：
  - 播放暂停、拖动、上一首下一首、音量与静音、播放模式都两边同步。
  - Folia 的「随机队列」按钮开关本软件的「列表随机播放」。
  - 在本软件里切歌、一首放完，Folia 跟着换歌和歌词。在本软件里开始放歌，Folia 也会接过来显示。
- **播放队列**：Folia 的队列就是本软件正在播放的列表，稍后播放的歌排在当前这首后面。
  - 在 Folia 里「下一首播放」「加入队列」都进本软件的稍后播放。删除、拖动排序请在本软件里做。
  - 在 Folia 里只放筛选出的歌、从平台账号的歌单起播时，那份队列放进本软件的临时列表，照它的顺序放。
- **音质**：Folia 的音质选择列的就是本软件「设置 → 播放设置」里的那几档（128K 普音 … 臻品母带），随时和这里的设置一致，不放歌时也一样。
  - 在 Folia 里选哪档就设成哪档，正在放的这首在原位置换成新音质。
  - 在这里改了，Folia 马上跟上。
- **安全**：接口只在本机（127.0.0.1）开放，带每次启动随机生成的令牌，只有本用户能读到；浏览器里的网页不能调用。

### 使用方法

1. 本软件：「设置 → 开放 API → Folia 对接」，默认已开启，旁边显示连接状态。
2. 安装 Folia 落雪对接版 0.7.28-lx.3 起，在 Folia 的平台里选「洛雪」，点「连接」。
3. 连上后，下面的「Folia 歌词舞台」推送自动暂停：Folia 已经直接跟着本软件播放。

两边谁先打开都可以，本软件重开后 Folia 会自动重连。本软件没开时，Folia 会提示「没有连上洛雪音乐」。

## 推送到 Folia 歌词舞台（给官方 Folia 用）

不想装落雪对接版时，可以把正在播放的歌曲与歌词推送给官方 Folia 的舞台模式，由 Folia 显示歌词动画。

- 推送歌名、歌手、专辑、时长、封面，以及歌词原文、翻译、罗马音、逐字四轨。
- 播放、暂停、拖动、倍速、切歌实时同步。
- 设置位置：本软件「设置 → 开放 API → Folia 歌词舞台」；Folia「设置 → 连接与集成」开启「舞台模式」，「舞台数据来源」选 Stage API。

官方 Folia 0.7.28 的舞台模式对外部推送的歌词，原文大字与逐字动画不显示（Folia 自身的问题）。落雪对接版已经修好；用官方版的话，macOS 上可以用 [补丁脚本](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/blob/main/scripts/folia-stage-fix-macos.sh) 临时补上。

## 修复

- 歌单详情页「收藏」的查重永远不命中，同一张歌单可以被收藏成好几个列表。
- 「平台账号管理」「音源音质测试」弹窗在窗口小时伸出内容区被裁掉，关闭按钮、最右的平台看不见。现在按内容区的大小排，窗口很矮时扫码区域可以滚动。

覆盖安装沿用原有配置。

> 本软件是 LX Music 桌面版的非官方增强分支，与原作者无关；Folia 落雪对接版同样是非官方分支。本软件自身不提供任何音频、歌词或封面，请只使用你有权访问的内容。

## English summary

LX Music Enhanced 3.4.0 adds pairing with the [Folia LX edition](https://github.com/xinzhihong-ship-it/folia-major/releases), for people who like Folia's lyric animations. **This app still does all the playing**; Folia shows the lyrics and works as a remote.

- Search tracks and playlists, browse your lists and platform-account playlists, and open shared playlist links from Folia.
- Play/pause, seeking, previous/next, volume, play mode, shuffle and quality stay in sync both ways; Folia's queue is this app's play list plus Play Later.
- The link listens only on 127.0.0.1 and needs a token generated at every launch. Turn it on under Settings → Open API → Folia link (on by default).
- You can still push the current track and lyrics to the official Folia's stage mode (Settings → Open API → Folia Lyrics Stage).
- Fixes: saving a shared playlist no longer creates duplicates; the Platform Accounts and source quality test dialogs fit small windows.

This is an unofficial fork of LX Music Desktop, not affiliated with its author. The app provides no audio, lyrics or cover art of its own; only use content you have the right to access.
