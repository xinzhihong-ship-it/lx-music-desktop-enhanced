# 洛雪音乐平台登录、用户歌单与每日推荐设计规格

> **目标：** 在现有 LX Music 桌面版（增强 fork）上，为酷狗、QQ 音乐、网易云音乐增加登录能力，获取登录账号的歌单列表，支持对歌单进行增删歌曲操作，并获取登录账号的每日推荐歌单。

## 1. 当前现状（由代码探索确认）

- **音乐 SDK**：`src/renderer/utils/musicSdk/` 下已内置 `kw/kg/tx/wy/mg/xm` 六个源，统一暴露 `musicSearch`、`songList`、`leaderboard`、`getMusicUrl`、`getLyric`、`getPic` 等接口。但 `getMusicUrl` 实际委托给 `api-source.js`，当前默认依赖自定义源（UserApi）。
- **无登录体系**：没有任何平台账号登录流程、全局登录态、登录弹窗或设置入口。网易 `wy/songList.js` 写死 `MUSIC_U=`  cookie，仅支持通过 `id###token` 手动传入 token 打开私有歌单。
- **本地列表 CRUD 已完善**：`src/renderer/store/list/` 提供 `createUserList`、`addListMusics`、`removeListMusics` 等本地 SQLite 操作；`UserListInfo` 已预留 `source` + `sourceListId` 字段，可用于绑定平台歌单。
- **UserApi 限制**：自定义源沙箱（`src/main/modules/userApi/renderer/preload.js`）当前只支持 `musicUrl`/`lyric`/`pic` 动作，无法扩展登录、用户歌单、歌单 CRUD。
- **无安全存储**：设置/数据通过 `src/main/utils/store.ts` 写明文 JSON，SQLite 也是明文；项目未使用 `electron.safeStorage` 或 keychain。
- **无每日推荐**：只有酷狗歌单广场有一个“每日推荐歌单”入口，并非登录账号的每日推荐歌曲列表。

## 2. 设计目标与边界

### 2.1 In-Scope

1. **平台登录**：酷狗（kg）、QQ 音乐（tx）、网易云音乐（wy）三种账号登录。
2. **用户歌单获取**：登录后拉取该平台「我的歌单」列表，并能在本地创建/同步对应的用户列表。
3. **歌单歌曲增删**：在平台侧歌单内添加或删除歌曲（以平台实际 API 能力为准）。
4. **每日推荐歌单**：登录后拉取该平台的每日推荐歌曲列表。
5. **安全凭证存储**：使用 Electron `safeStorage` 加密保存各平台 token/cookie。

### 2.2 登录方式

首期目标为网易云音乐实现以下三种登录方式；QQ 音乐与酷狗待后续按同一接口适配。

1. **二维码登录（推荐）**：平台返回二维码图片，客户端轮询扫码状态，登录成功后服务端通过 Set-Cookie 下发 token。用户不需要在桌面端输入密码，最安全。
2. **手机号 + 密码登录**：调用平台登录接口，密码在本地做平台要求的加密后传输。成功后保存 cookie/token。
3. **手机号 + 短信验证码登录**：先调用发送短信接口，再使用手机号 + 验证码调用登录接口。

Cookie/Token 直接导入仍作为兜底方式保留。

### 2.3 Out-of-Scope（首期）

- 不修改播放 URL 获取链路；登录态仅用于元数据（歌单、推荐）与歌单 CRUD。若后续需要会员音质，再评估是否将 token 传入 `api-source`。
- 不与现有 Sync（局域网列表同步）功能耦合。
- 酷我、咪咕、虾米等其他源的首期登录支持。
- 邮箱登录、第三方 OAuth（微信/QQ 授权）等未在需求中提及的登录方式。

## 3. 方案对比

### 方案 A：扩展 UserApi / 自定义源（最符合现有架构）

在 `UserApiSourceInfoActions` 中新增 `login`、`userPlaylists`、`playlistAdd`、`playlistRemove`、`dailyRecommend` 等动作；自定义源脚本实现各平台逻辑；核心应用只负责 UI 与调用沙箱接口。

- **优点**：平台逻辑与核心解耦，和现有 `musicUrl` 委托模型一致；核心改动小。
- **缺点**：用户必须安装支持登录的自定义源；登录态在沙箱内难以安全持久化；UI 与脚本协议需要强约定。

### 方案 B：直接在内置 SDK 中实现（最符合用户体验）

在 `kg/tx/wy` 各源目录下新增 `login.ts`、`user.ts` 模块，由核心应用直接处理登录 UI、token 持久化、歌单同步与 CRUD。

- **优点**：开箱即用；可统一安全存储；UI 体验最完整。
- **缺点**：核心代码量最大；需要维护三套平台登录/歌单 API；与上游差异进一步拉大。

### 方案 C：混合架构（推荐）

核心应用负责「账号会话层」（登录 UI、token 安全存储、登录状态管理、通用用户歌单 UI），各平台在自身 SDK 目录下实现 `login` 与 `user` 适配器。`api-source.js` 仍负责播放 URL，首期不扩展。

- **优点**：平台逻辑仍分散在各源目录，便于维护；核心有统一会话层，体验接近内置实现；后续可把协议暴露给 UserApi。
- **缺点**：需要设计清晰的源-会话接口。

**本规格采用方案 C**，以网易云音乐作为首个验证平台（有公开参考实现 `NeteaseCloudMusicApi`），随后迁移到 QQ 音乐与酷狗。

## 4. 架构设计

### 4.1 新增模块

```
src
├── common
│   └── types
│       ├── account.d.ts          # 登录会话、平台账号类型
│       └── musicSdk.d.ts         # 扩展 Source 接口：login / user / dailyRecommend
├── main
│   └── modules
│       └── account
│           ├── index.ts          # 主进程入口：IPC 路由
│           ├── store.ts          # 使用 safeStorage 加密存取 token
│           └── sessions.ts       # 管理各平台登录会话
├── renderer
│   ├── store
│   │   └── account.ts            # 渲染进程登录态、当前选中账号
│   ├── utils
│   │   └── musicSdk
│   │       ├── account.ts        # 统一账号操作入口
│   │       ├── wy/login.ts       # 网易登录适配
│   │       ├── wy/user.ts        # 网易用户歌单/每日推荐/CRUD
│   │       ├── tx/login.ts       # QQ 登录适配（二期）
│   │       ├── tx/user.ts        # QQ 用户歌单/每日推荐/CRUD（二期）
│   │       ├── kg/login.ts       # 酷狗登录适配（二期）
│   │       └── kg/user.ts        # 酷狗用户歌单/每日推荐/CRUD（二期）
│   └── views
│       ├── Setting/components/AccountModal.vue   # 登录/账号管理入口
│       └── List/MyList/components/SyncPlatformList.vue  # 同步平台歌单
└── docs/superpowers/plans/...
```

### 4.2 数据模型

```typescript
// common/types/common.d.ts -> namespace LX.Account
type LoginMethod = 'qrcode' | 'phone_password' | 'phone_sms' | 'cookie'

interface PlatformAccount {
  id: string              // uuid
  source: 'wy' | 'tx' | 'kg'
  nickname: string
  avatar?: string
  isLogin: boolean
  // token 等敏感字段只在主进程内存 / safeStorage 中，不进入渲染进程 store
}

interface LoginSession {
  source: LX.OnlineSource
  cookies: Record<string, string>
  tokens: Record<string, string>
  expiresAt?: number
}

interface QrCodeLoginState {
  key: string
  qrUrl: string          // 二维码图片 URL（data URL 或平台返回的链接）
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed'
  message?: string
}
```

### 4.3 关键接口

每个源需要实现（渲染进程）：

```typescript
interface SourceAccountAdapter {
  // 该源支持的登录方式
  loginMethods: LoginMethod[]

  // Cookie 导入（兜底）
  loginByCookie(cookie: string): Promise<{ account: PlatformAccount; session: LoginSession }>

  // 二维码登录：生成二维码 → 轮询状态 → 确认后返回账号
  createQrCode(): Promise<QrCodeLoginState>
  checkQrCodeStatus(state: QrCodeLoginState): Promise<QrCodeLoginState & { session?: LoginSession; account?: PlatformAccount }>

  // 手机号 + 密码
  loginByPhonePassword(phone: string, password: string, countrycode?: string): Promise<{ account: PlatformAccount; session: LoginSession }>

  // 手机号 + 短信验证码
  sendPhoneSms(phone: string, countrycode?: string): Promise<void>
  loginByPhoneSms(phone: string, captcha: string, countrycode?: string): Promise<{ account: PlatformAccount; session: LoginSession }>

  // 拉取用户歌单列表
  getUserPlaylists(session: LoginSession, page: number): Promise<ListInfoItem[]>
  // 歌单 CRUD
  addToPlaylist(session: LoginSession, listId: string, songId: string): Promise<void>
  removeFromPlaylist(session: LoginSession, listId: string, songId: string): Promise<void>
  // 每日推荐
  getDailyRecommend(session: LoginSession): Promise<LX.Music.MusicInfoOnline[]>
}
```

### 4.4 流程

1. **登录**：用户在设置页选择平台与登录方式：
   - 二维码：展示二维码图片并轮询，扫码确认后获得 cookie；
   - 手机号+密码：输入后本地加密传输，成功后保存 cookie；
   - 手机号+验证码：先发送短信，再输入验证码登录；
   - Cookie：直接粘贴 Cookie。
   成功后加密存储 token，渲染进程更新 `accountStore`。
2. **获取用户歌单**：用户在「我的列表」点击「同步平台歌单」→ 渲染进程调用 `SourceAccountAdapter.getUserPlaylists` → 主进程把请求带 token 发出 → 返回后与本地的 `source`/`sourceListId` 匹配，更新或创建本地用户列表。
3. **增删歌曲**：在平台歌单详情页（或本地同步列表）右键歌曲 → 调用 `addToPlaylist` / `removeFromPlaylist` → 成功后刷新本地缓存。
4. **每日推荐**：新增侧边栏入口「每日推荐」→ 选择已登录平台 → 调用 `getDailyRecommend` → 写入临时列表或直接展示。

## 5. 安全与隐私

- 所有 token/cookie 必须通过 `electron.safeStorage` 加密后落盘，主进程持有解密密钥；渲染进程只接收脱敏后的 `PlatformAccount`（昵称、头像、是否登录）。
- 登录凭证不参与 Sync、不参与自定义源。
- 明确提示用户：该功能需要向平台服务器发送登录凭证，存在账号风险；仅用于个人本地管理歌单。

## 6. 风险与待验证项

1. **平台 API 不稳定性**：QQ 音乐与酷狗的登录、歌单 CRUD、每日推荐接口需要逆向或参考社区实现，存在接口变动、风控、签名更新风险。
2. **账号风控**：频繁调用用户接口可能导致平台限制登录或封号。
3. **法律/合规风险**：登录后获取会员-only 内容或绕过平台客户端，可能违反平台 ToS。首期严格限制为「歌单元数据管理」，不用于获取播放 URL。
4. **UI/UX 复杂度**：需要新增多处界面（登录弹窗、账号管理、同步入口、每日推荐页）。

## 7. 验证标准

- 网易云音乐可通过 Cookie / 二维码登录。
- 登录后可拉取「我的歌单」并同步到本地用户列表。
- 可在同步后的网易云歌单内添加/删除歌曲，且平台侧生效。
- 可查看网易云「每日推荐歌曲」。
- token 以加密形式存储，进程中不泄露明文。

## 8. 首期范围

鉴于工作量巨大，首期只实现 **网易云音乐** 一个平台的完整流程（登录、用户歌单同步、歌单 CRUD、每日推荐），并形成可复用的 `account` 层与源适配器接口；QQ 音乐与酷狗在后续迭代中按相同接口实现。
