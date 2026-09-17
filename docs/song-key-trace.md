# 歌曲基调（song key）链路追踪与「重新分析后分段消失」的根因

追踪范围：分析取样 → 时间轴 → 落地缓存 → 面板/独立窗口展示 → 跟播与插件同步。
结论先行：**分段消失不是 UI 的锅，是分析输入被截断了** —— 无损大文件只能拿到开头 4MB（约 20 秒），
算出来的时间轴只剩 1~2 段，面板按「段数」决定模式，于是从「分段设置」掉回「整首统一」，分段区被隐藏。

## 1. 链路全貌

**触发**（`src/renderer/store/player/songKey.ts`）

| 入口 | 位置 | force |
| --- | --- | --- |
| 切歌 / 启动 | `songKey.ts:417-423`（watch musicInfo.name/singer，immediate） | false |
| 播放源自愈（换源、同曲重播） | `songKey.ts:452-462`（仅当当前没有基调时才补跑） | false |
| 面板「重新分析」 | `SongKeyModal.vue:542-548` | true |
| 播放栏基调标签双击 | `SongKeyTag.vue`（同 force 重析） | true |
| 独立窗口「重新分析」 | `songKey.ts:363-366` | true |
| 「恢复自动识别」 | `clearCurrentSongKey` → `songKey.ts:407-412` | true |

**`updateCurrentSongKey(force)`（`songKey.ts:187-300`）分支顺序**

1. `!force` 且 `resolveSongKeySync` 命中 → 直接返回（用户设定 > 内置曲库 > 分析缓存，`musicKey/index.ts:177-195`）。
2. `!force` 时再走异步存储读取 `resolveSongKey`（`index.ts:204-222`）。
3. `force` 时只认用户手动设定的基调（`getSavedUserKey`，`songKey.ts:230-235`），所以「重新分析」不会覆盖用户设定的调。
4. 真实音频分析：等本曲自己的音源就绪 `waitOwnedResource`（`songKey.ts:176-185`，按歌曲 id 匹配，15s 上限）→
   `analyzeSongAudio`（`musicKey/audioAnalysis.ts:266-369`）→ 逐窗 K-S 分析 → `buildTimeline`。
5. 置信度 ≥ 0.5 才 `saveAnalyzedKey` 落缓存（`songKey.ts:285-289`、`index.ts:145-171`）。

**取样链路（本次问题所在）**

```
audioAnalysis.analyzeSongAudio  (audioAnalysis.ts:266)
  ├ fetchSongKeyAudio(source, 4MB)        渲染进程 → IPC → 主进程
  │   ├ renderer/utils/ipc.ts:378
  │   ├ common/ipcNames.ts:105  song_key_fetch_audio
  │   ├ main/modules/winMain/rendererEvent/songKey.ts:38-56（bilibili 走 CDN headers）
  │   └ main/utils/songKeyAudio.ts:145 → readRemote(115)/readLocal(85)
  │        Range: bytes=0-4194303，返回 { bytes, totalBytes, truncated }
  ├ decodeAudio（首块） → resampleToMono → 逐窗分析
  ├ canFetchAll = truncated && total <= TIMELINE_FETCH_LIMIT(48MB)   (audioAnalysis.ts:20,301)
  │     成立 → 再取一次全量字节 → decode → 整曲时间轴
  │     不成立（>48MB 或服务端不给总长）→ **旧实现只能用首块那 20 秒**  ← 本次根因
  └ buildTimeline：12s 窗 / 2s 步进、中值平滑、<8s 的段合并、相邻同调性去重 (audioAnalysis.ts:180-235)
```

**展示**

- 面板 `SongKeyModal.vue`：`hydrate()` 把 `songKeyInfo.timeline` 灌进 `segments`，并**按段数决定模式**
  （`timeline.length > 1 ? 'segments' : 'whole'`，`SongKeyModal.vue:259-289`）；分段区是 `v-if="mode === 'segments'"`（`:48`）。
  `watch(songKeyInfo)`（`:486-489`）受 `touched` 保护，避免分析迟到覆盖用户正在编辑的内容。
- 独立窗口 `songKeyViewerHtml.ts`：用 `updatedAt:段数:key` 组 `keyVersion`（`:801-804`、`:838-867`）判断是否重建时间轴，
  且只会切进分段模式，不会退回整首。

**跟播**：`playbackSeconds`（timeupdate + 500ms 轮询，`songKey.ts:430-448`）→ `segmentAt`（`audioAnalysis.ts:374-389`，超尾取末段）
→ `activeSongKey` → `effectiveSongKey`（叠加 pitchShifter 移调）→ `watch` 推给机架插件（`songKey.ts:162-166`、`plugin_sync`）。

## 2. 现象与实测证据（2026-09-17，本机 dev 实例）

- 正在播放的歌：酷我无损 `F0000015VtPx0Pvxqj.flac`，`Content-Range: bytes 0-57120221/57120222` → **57.1MB**，时长 4:21，48kHz。
- `TIMELINE_FETCH_LIMIT = 48MB` → `canFetchAll = false` → 只能分析首块 4MB。
- 用内置 ffmpeg 实测同一首歌：
  - 前 4MB 只能解出 **20.05 秒**（且尾部残缺），逐窗分析 → **2 段**；
  - 整曲解码（261.8 秒）→ **15 段**。
- 用户数据佐证：`LxDatas/data.json` 里 19:51、19:52 写入的两条记录 `timeline` 长度都是 **1**
  （`想要找的地方__小阿枫`、`想要找的地方__刘静格格`），即「分析成功、但只覆盖了开头」。
- 于是：点「重新分析」→ 新结果只有 1 段 → 面板 `mode` 掉回 `whole` → 分段列表整块消失。
  若歌曲本身带转调，用户此前看到的段数（来自更早一次能覆盖全曲的分析）与新结果差距极大，观感就是「分段没了」。

## 3. 三个叠加因素（缺一不可）

1. **输入被截断**（根因）：`audioAnalysis.ts:20` 的 48MB 上限 + 首块 4MB 采样；无损文件普遍 50~100MB。
2. **面板按段数决定模式**：`SongKeyModal.vue:270`，1 段就切回「整首统一」，分段区被 `v-if` 摘掉。
3. **重新分析期间被清空**：`songKey.ts:213` 无条件 `songKeyInfo = null`，面板 `watch` 立刻 `hydrate()` 成空壳；
   分析失败时（`songKey.ts:280-283`）这个空状态是永久的。
   另外 `SongKeyModal.vue:269` 的 `info.source !== 'user'` 会把用户自己存的多段基调也强制显示成「整首统一」。

## 4. 修复

| # | 改动 | 位置 |
| --- | --- | --- |
| 1 | 新增整曲 PCM 通路：内置 ffmpeg 解码整首歌为 11kHz 单声道 s16le（本地文件直接读、远端由主进程取流灌 stdin，跟随应用代理），4 分钟曲子约 5.8MB | `src/main/utils/songKeyAudio.ts` `decodeSongKeyPcm`、`src/main/utils/ffmpegBinary.ts`（与音频转换共用的 ffmpeg 路径解析）、`ipcNames.ts`、`common/rendererEvent/songKey.ts`、`renderer/utils/ipc.ts` |
| 2 | 「首块覆盖不了整曲」（>48MB 或服务端不给总长）时改走整曲 PCM；PCM 拿不到则退回首块（保持旧行为，不新增失败面） | `audioAnalysis.ts:298-336` |
| 3 | 「重新分析」不再清空当前结果：分析期间保留旧的时间轴，失败也保留，下次成功再整体替换 | `songKey.ts:211-219`、`276-283` |
| 4 | 「恢复自动识别」先主动清空再重算（语义不变） | `songKey.ts:407-414` |
| 5 | 用户自己保存的多段基调打开面板时进入分段模式，不再被 `source === 'user'` 藏起来 | `SongKeyModal.vue:265-271` |
| 6 | 分析中提示改为按 `isKeyAnalyzing` 驱动，并区分「首次分析 / 重新分析」文案 | `SongKeyModal.vue:29-33,490-495` |
| 7 | 启动参数 `--proxy-server=http://host:port` 解析支持协议前缀（mpv 走 `--http-proxy` 时需要裸 host:port） | `src/main/utils/index.ts:305-341` |

### 4.1 第二轮：面板拿到结果后不显示（`touched` 过宽 + 切歌不重置）

用户反馈「分析完成后，整首统一里的音高、分段设置里的分段时间与调都不显示」。原因是面板里那个
「用户动过编辑器就不再接受迟到的分析结果」的开关（`touched`）口径太宽：

- `switchMode()`（点「整首统一 / 分段设置」）也会 `touched = true`（旧 `SongKeyModal.vue:379-390`）。
  于是用户点一下「分段设置」去看分段，之后所有分析结果都被 `watch(songKeyInfo)` 的守卫挡在门外
  —— 面板里没有分段时间与调，音名网格的高亮也不再跟着播放走（`watch(effectiveSongKey)` 同样被 `touched` 挡住），
  看起来就像这个功能根本没实现。
- 切歌时 `touched` 不会重置：开着面板切歌，新歌分析完了面板仍停在上一首的调与分段上。

修复（`SongKeyModal.vue`）：

| # | 改动 |
| --- | --- |
| 8 | 只有真正改内容（改调式/改分段/改时间/删段）才算「动过」，切换模式不算：新增 `modePinned` 承载「用户手动选过模式」，`applyModeFromTimeline()` 只在未 pinned 时按段数决定模式 |
| 9 | 新增切歌 watch：重置 `touched`/`userSelectedSegment`/`modePinned` 并在面板打开时重新 `hydrate()` |
| 10 | 重新分析时解除 `modePinned`（重新分析就是为了看新结果，模式交给结果决定） |

真机验证（dev 实例，硬重载渲染进程后）：面板开着点「分段设置」→ 点「下一首」→ 面板立刻清空为「未识别」，
2.5 秒后填入新歌的早期结果（1=E 大调），5 秒后完整结果落地：`Ebm 小调 / 12 段 / 分段模式`；
随后随播放实时变化 —— 面板徽标 `Ebm → 1=B → 1=E`，音名网格高亮同步 `D#/Eb → B → E`，
即「当前调 + 分段时间/调」都跟着播放走（修复前：网格高亮停在 `G#/Ab`、面板不随切歌更新）。

### 4.2 第三轮：独立悬浮窗逐项体检

用户反馈「独立窗口的重新分析好像没用」。逐项实测（`songKeyViewerHtml.ts` 是主进程里的一整页 HTML，
重启应用才生效；窗口内部脚本可用主进程 `executeJavaScript` 驱动测试）：

| 功能 | 实测结论 |
| --- | --- |
| 歌名/歌手/当前调/来源标签、段落列表、播放段 ▶、播放位置 | 正常，实时跟播 |
| **重新分析** | **分析确实跑了**（缓存 `updatedAt` 刷新、时间轴与窗口一致），但**界面零反馈**：提示框条件是 `isKeyAnalyzing && !currentKey`，而 store 现在会保留旧结果 → 永远不满足；再加上如果这首歌被手动记忆过，`updateCurrentSongKey(true)` 会按设计原样返回用户设定。两个原因叠加，点完就像没反应 |
| **双击改时间** | 播放中每 500ms 的同步都会重建整张段落列表 → 输入框被重建、已输入内容丢失、焦点被抢走（暂停时不复现） |
| **切模式后跟播** | `switchMode()` 把 `touched` 置 true（与内置面板同一个坑）→ 点过模式后段落选择不再跟播 |
| 用户自存的多段基调 | `info.source !== 'user'` 才切分段模式 → 用户保存的分段在窗口里显示成「整首统一」 |
| 即时试听 | 不判断「全局同步机架」开关，关着也照推送插件（内置面板是判断的，两边不一致） |
| 新增/删除一段、保存并应用、恢复自动识别、置顶、关闭 | 实测正常（保存写入 `source=user`、恢复可清回分析记录、`alwaysOnTop` 可切、窗口可关） |
| 全局同步机架、电音深度 | 实测正常（写全局设置） |

修复（`songKeyViewerHtml.ts` + 面板同款）：

| # | 改动 |
| --- | --- |
| 11 | 提示条改为 `notice > isKeyAnalyzing > 隐藏` 三级：分析中显示「正在按当前音源重新分析…」（保留旧结果时也提示），一次性说明用 `showNotice(text, ms)` |
| 12 | 点「重新分析」先判别 `songKeyInfo.source === 'user'`，是则提示「已手动记忆基调，重新分析不会覆盖它；想重新识别请先点恢复自动识别」并不发起重算；否则立刻显示「正在重新分析…」并解除 `modePinned` |
| 13 | `touched` 只由真正改内容触发；模式切换用新 `modePinned`；数据回来时按 `timeline.length` 决定模式（不再排除 `user` 来源），切歌重置 |
| 14 | 编辑时间期间跳过 500ms 的列表重建（新数据到来时结束编辑） |
| 15 | `sendInstantAudition()` 受「全局同步机架」开关约束，与内置面板一致 |
| 16 | 内置面板同步加同一条「已手动记忆基调」提示（`SongKeyModal.vue` 的 `notice`） |

真机验证：重析后提示条即时出现并在结果落地后消失；播放中双击改时间输入 `0:07` 持续 4.8 秒仍在、未被清掉；
关掉开关点音名不写 Auto-Key handoff、打开后点音名即写入；重开窗口后点「整首统一 → 分段设置」，
段落选择继续跟播（`selected == playing` 随播放 7→8→9）；手动保存后点重新分析出现说明提示，
点「恢复自动识别」回到音频分析。测试期间改动的用户数据（保存/试听开关/速度）均已还原。

### 4.3 第四轮：「记住这首歌的基调」补齐并挪出「整首统一」

用户指出：独立悬浮窗没有「记住这首歌的基调（下次播放直接采用）」这个选项；而且它不该放在「整首统一」里，
应该和「全局同步机架」放同一排（否则切到「分段设置」就看不见了）。

核查结果：内置面板里这个勾选框**从来没接线**（`SongKeyModal.vue` 里只声明 + `v-model` 绑定，`handleSave` 完全没用它），
且被 `v-if="mode === 'whole'"` 限制在整首统一模式里 —— 也就是说它一直是个装饰品；悬浮窗连装饰品都没有。

改动：

| # | 改动 |
| --- | --- |
| 17 | `KeyInfo` 新增 `sessionOnly?: boolean`（两个 `types/song_key.d.ts`）：标记"只在本次会话生效"的设定 |
| 18 | store 新增 `applyCurrentSongKeyForSession({ key, scale, timeline })`：立刻生效并跟播、照常同步机架，但**不写库**（经 `normalizeUserTimeline` 规整时间轴） |
| 19 | 「记住」勾选框挪到吸底条、与「全局同步机架」同排（内置面板 `footerFlags` + 悬浮窗 footer），两种模式下都可见；内置面板去掉原来 `v-if="mode === 'whole'"` 的那一段 |
| 20 | 内置面板 `handleSave`：取消勾选 → 走会话应用；勾选 → 照旧写库。悬浮窗保存回传新增 `remember` 字段，store 的 `onSongKeyWindowSaveAction` 同样分流 |
| 21 | 来源标签：会话值显示「仅本次」（面板 `sourceText`、悬浮窗 `sourceMap`、播放栏 tooltip 三处一致）；「重新分析」的"已记忆"提示只对**真正写库**的用户设定生效 |

真机验证（面板 + 悬浮窗各一遍，两种模式都检查过）：勾选框都在「全局同步机架」旁边且切换模式不消失；
取消勾选保存 → 标签变「仅本次」、`data.json` 里用户记忆记录为 0 条；勾选保存 → 「已记忆」并写库；
「恢复自动识别」可清回音频分析。单测新增 `取消「记住这首歌的基调」：只在本会话生效，不写库`（16 项 store 用例全过）。

## 5. 验证

- 单测：`npm run test:song-key`（55 通过，含新增大文件走 PCM、PCM 不可用时退回首块、真跑 ffmpeg 解码本地 WAV 三例）；
  `issue19`（11 通过，顺带修好了它此前因缺 `@renderer/core/player/playbackIntent` 解析而整体 import 失败的问题）、
  `audioConversion` / `qualityLabels` / `playbackIntent` / `playerRouting` / `actualQuality` / `songKeyStore` 等 75 通过。
- 静态：`npm run lint` 通过；`npm run build:renderer`、`npm run build:main` 通过。
- 真机通路：对那首 57MB 无损实际调用 `decodeSongKeyPcm` → 2.2s 解出 261.8s / 5.77MB PCM → 时间轴 **15 段**（修复前 2 段）。
- 应用内验证（dev 实例，重启到新构建后）：播放 53.8MB 无损（`想要找的地方__刘静格格`），在面板点「重新分析」——
  面板全程保持打开并提示「正在按当前音源重新分析」，约 6 秒后自动切到「分段设置」，给出 5 段
  （0s Dbm / 32s E / 48s Dbm / 64s Abm / 72s Dbm，含 32~72 秒的转调点，旧实现只看得到前 20 秒），
  与同素材独立复算的结果完全一致；缓存记录由 `tl=1` 更新为 5 段。

## 6. 已知限制

- PCM 单次上限 600 秒、空闲超时 90 秒（持续有数据则不打断）：超长音频（>10 分钟）的时间轴只覆盖前 600 秒，超出部分按最后一段处理。
- 首块解码仍会先跑一次（用于尽快出初值）；比 4MB 小但服务端不给 `totalBytes` 的极少数音源现在也会走 PCM 通路。
- 没有随包 ffmpeg 的环境（未构建的源码运行）自动退回首块行为，不会报错也不会编造结果。
