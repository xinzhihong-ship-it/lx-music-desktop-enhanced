# 网易云音乐登录、用户歌单与每日推荐实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 LX Music 桌面版中实现网易云音乐账号登录、用户歌单同步、歌单歌曲增删、每日推荐歌曲列表，并搭建可复用的平台账号层。

**Architecture:** 采用「核心会话层 + 源适配器」混合架构。主进程通过 `electron.safeStorage` 安全存储 token；渲染进程维护只读的登录态 store；`src/renderer/utils/musicSdk/wy/` 下新增 `login.ts` 与 `user.ts` 适配器；UI 新增登录弹窗与平台歌单同步入口。

**Tech Stack:** Electron 40、Vue 3、TypeScript、better-sqlite3、needle、electron.safeStorage。

## Global Constraints

- 必须复用现有 `src/renderer/utils/musicSdk/` 源目录结构。
- 不得破坏现有 `musicUrl` / `api-source.js` 链路（首期登录态不传入播放 URL 获取）。
- 敏感凭证不得明文落盘；渲染进程不得直接访问 token 明文。
- 所有新增代码必须通过 `npm run lint`。
- 优先使用 TypeScript；若修改现有 `.js` 源文件，可保持 `.js` 但新增文件优先 `.ts`。

---

## Task 1: 账号类型定义与主进程安全存储层

**Files:**
- Create: `src/common/types/account.d.ts`
- Create: `src/main/modules/account/store.ts`
- Create: `src/main/modules/account/sessions.ts`
- Create: `src/main/modules/account/index.ts`
- Modify: `src/common/types/ipc_main.d.ts`（添加账号相关 IPC 类型）
- Modify: `src/common/types/ipc_renderer.d.ts`（添加账号相关 IPC 类型）

**Interfaces:**
- Consumes: `electron.safeStorage`, existing IPC types.
- Produces: `getAccounts()`, `saveAccount(id, source, encrypted)`, `removeAccount(id)`, `getSession(source)`, `updateSession(source, session)`.

- [ ] **Step 1: Write types**

Create `src/common/types/account.d.ts`:

```typescript
declare namespace LX {
  namespace Account {
    type Source = 'wy' | 'tx' | 'kg'

    interface PlatformAccount {
      id: string
      source: Source
      nickname: string
      avatar?: string
      isLogin: boolean
    }

    interface LoginSession {
      source: Source
      cookies: Record<string, string>
      tokens: Record<string, string>
      expiresAt?: number
    }

    interface EncryptedSession {
      iv: string
      data: string
    }
  }
}
```

- [ ] **Step 2: Implement safe storage**

Create `src/main/modules/account/store.ts`:

```typescript
import { safeStorage } from 'electron'
import store from '@main/utils/store'

const accountStore = store('account_sessions')

const encrypt = (text: string): LX.Account.EncryptedSession => {
  const iv = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const buffer = safeStorage.encryptString(text)
  return {
    iv,
    data: buffer.toString('base64'),
  }
}

const decrypt = (encrypted: LX.Account.EncryptedSession): string => {
  return safeStorage.decryptString(Buffer.from(encrypted.data, 'base64'))
}

export const saveSession = (id: string, session: LX.Account.LoginSession) => {
  accountStore.set(id, encrypt(JSON.stringify(session)))
}

export const getSession = (id: string): LX.Account.LoginSession | null => {
  const encrypted = accountStore.get<LX.Account.EncryptedSession>(id)
  if (!encrypted) return null
  return JSON.parse(decrypt(encrypted))
}

export const removeSession = (id: string) => {
  accountStore.set(id, undefined)
}

export const listAccountIds = (): string[] => {
  const raw = accountStore.get<Record<string, unknown>>('') ?? {}
  return Object.keys(raw)
}
```

- [ ] **Step 3: Add IPC handlers**

Create `src/main/modules/account/index.ts` exposing renderer IPC handlers: `account:list`, `account:save`, `account:remove`, `account:getSession`. (Session plaintext is only returned to the renderer if absolutely necessary for direct API calls; otherwise main process should proxy requests. For this plan, main process proxies all authenticated requests, so `getSession` is internal only.)

- [ ] **Step 4: Register module**

Modify `src/main/modules/index.ts` to import and initialize the account module.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: no errors in new files.

- [ ] **Step 6: Commit**

```bash
git add src/common/types/account.d.ts src/main/modules/account/ src/common/types/ipc_*.d.ts src/main/modules/index.ts
git commit -m "feat(account): add secure session storage and IPC scaffold"
```

---

## Task 2: 网易云登录适配器（Cookie / Token 导入）

**Files:**
- Create: `src/renderer/utils/musicSdk/wy/login.ts`
- Modify: `src/renderer/utils/musicSdk/wy/index.js`

**Interfaces:**
- Consumes: `httpFetch` from `src/renderer/utils/request.js`, NetEase crypto from `wy/utils/crypto.js`.
- Produces: `wyLoginAdapter.loginByCookie(cookieString): Promise<LX.Account.PlatformAccount>`.

- [ ] **Step 1: Add login module**

Create `src/renderer/utils/musicSdk/wy/login.ts`:

```typescript
import { httpFetch } from '@renderer/utils/request'

const WY_API = 'https://music.163.com'

export const loginByCookie = async (cookieString: string): Promise<LX.Account.PlatformAccount> => {
  const response = await httpFetch(`${WY_API}/api/nuser/account/get`, {
    method: 'post',
    headers: {
      Cookie: cookieString,
    },
  }).promise

  if (response.statusCode !== 200 || response.body.code !== 200) {
    throw new Error(response.body.message || '登录失败')
  }

  const profile = response.body.profile
  if (!profile) throw new Error('未获取到用户信息')

  return {
    id: `wy_${profile.userId}`,
    source: 'wy',
    nickname: profile.nickname,
    avatar: profile.avatarUrl,
    isLogin: true,
  }
}

export const parseCookieString = (cookieString: string): Record<string, string> => {
  const cookies: Record<string, string> = {}
  cookieString.split(';').forEach(part => {
    const [key, value] = part.trim().split('=')
    if (key && value !== undefined) cookies[key] = value
  })
  return cookies
}
```

- [ ] **Step 2: Wire into wy source**

Modify `src/renderer/utils/musicSdk/wy/index.js`:

```javascript
import loginAdapter from './login'

const wy = {
  // ... existing exports
  login: loginAdapter,
}
```

- [ ] **Step 3: Add unit test**

Create `tests/renderer/musicSdk/wy/login.test.ts` (if test infrastructure exists; otherwise add a manual verification script in `scripts/verify-wy-login.js`):

```javascript
const { loginByCookie, parseCookieString } = require('../../../src/renderer/utils/musicSdk/wy/login.ts')

const cookie = process.env.WY_COOKIE
if (!cookie) {
  console.error('Set WY_COOKIE env')
  process.exit(1)
}

loginByCookie(cookie).then(account => {
  console.log('Account:', account)
}).catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/utils/musicSdk/wy/login.ts src/renderer/utils/musicSdk/wy/index.js tests/renderer/musicSdk/wy/login.test.ts scripts/verify-wy-login.js
git commit -m "feat(wy): add cookie-based login adapter"
```

---

## Task 3: 网易云用户歌单、歌单 CRUD、每日推荐适配器

**Files:**
- Create: `src/renderer/utils/musicSdk/wy/user.ts`
- Modify: `src/renderer/utils/musicSdk/wy/index.js`
- Modify: `src/common/types/musicSdk.d.ts` (create if not exists)

**Interfaces:**
- Consumes: `httpFetch`, NetEase crypto, existing `filterList` / `filterListDetail` helpers.
- Produces: `getUserPlaylists(session, page)`, `addToPlaylist(session, listId, songId)`, `removeFromPlaylist(session, listId, songId)`, `getDailyRecommend(session)`.

- [ ] **Step 1: Implement user adapter**

Create `src/renderer/utils/musicSdk/wy/user.ts`:

```typescript
import { httpFetch } from '@renderer/utils/request'
import { formatPlayCount, formatPlayTime, formatSingerName } from '../utils'
import musicDetailApi from './musicDetail'

const cookieString = (cookies: Record<string, string>) =>
  Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

export const getUserPlaylists = async (
  session: LX.Account.LoginSession,
  page = 1,
  limit = 30
): Promise<LX.SongList.ListInfoItem[]> => {
  const offset = (page - 1) * limit
  const res = await httpFetch('https://music.163.com/api/user/playlist', {
    method: 'post',
    headers: { Cookie: cookieString(session.cookies) },
    form: {
      uid: session.tokens.userId,
      limit,
      offset,
    },
  }).promise

  if (res.statusCode !== 200 || res.body.code !== 200) {
    throw new Error(res.body.message || '获取用户歌单失败')
  }

  return res.body.playlist.map((item: any) => ({
    id: String(item.id),
    name: item.name,
    author: item.creator.nickname,
    play_count: formatPlayCount(item.playCount),
    img: item.coverImgUrl,
    desc: item.description,
    source: 'wy',
    total: String(item.trackCount),
  }))
}

export const addToPlaylist = async (
  session: LX.Account.LoginSession,
  listId: string,
  songId: string
): Promise<void> => {
  const res = await httpFetch('https://music.163.com/api/playlist/manipulate/tracks', {
    method: 'post',
    headers: { Cookie: cookieString(session.cookies) },
    form: {
      op: 'add',
      pid: listId,
      tracks: songId,
    },
  }).promise

  if (res.statusCode !== 200 || res.body.code !== 200) {
    throw new Error(res.body.message || '添加失败')
  }
}

export const removeFromPlaylist = async (
  session: LX.Account.LoginSession,
  listId: string,
  songId: string
): Promise<void> => {
  const res = await httpFetch('https://music.163.com/api/playlist/manipulate/tracks', {
    method: 'post',
    headers: { Cookie: cookieString(session.cookies) },
    form: {
      op: 'del',
      pid: listId,
      tracks: songId,
    },
  }).promise

  if (res.statusCode !== 200 || res.body.code !== 200) {
    throw new Error(res.body.message || '删除失败')
  }
}

export const getDailyRecommend = async (
  session: LX.Account.LoginSession
): Promise<LX.Music.MusicInfoOnline[]> => {
  const res = await httpFetch('https://music.163.com/api/v3/discovery/recommend/songs', {
    method: 'post',
    headers: { Cookie: cookieString(session.cookies) },
  }).promise

  if (res.statusCode !== 200 || res.body.code !== 200) {
    throw new Error(res.body.message || '获取每日推荐失败')
  }

  const trackIds = res.body.data.dailySongs.map((s: any) => s.id)
  const detail = await musicDetailApi.getList(trackIds)
  return detail.list as LX.Music.MusicInfoOnline[]
}
```

- [ ] **Step 2: Wire into wy source**

Modify `src/renderer/utils/musicSdk/wy/index.js`:

```javascript
import userAdapter from './user'

const wy = {
  // ... existing exports
  user: userAdapter,
}
```

- [ ] **Step 3: Verify with real NetEase account**

Set `WY_COOKIE` env and run:

```bash
node scripts/verify-wy-user.js
```

Script should print user playlists, add/remove a song (use a test playlist), and fetch daily recommend.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/utils/musicSdk/wy/user.ts src/renderer/utils/musicSdk/wy/index.js src/common/types/musicSdk.d.ts scripts/verify-wy-user.js
git commit -m "feat(wy): add user playlists, playlist CRUD and daily recommend"
```

---

## Task 4: 渲染进程账号 Store

**Files:**
- Create: `src/renderer/store/account.ts`
- Modify: `src/renderer/utils/ipc.ts`（若尚无账号 IPC 方法）

**Interfaces:**
- Consumes: main process IPC for account CRUD.
- Produces: `accounts` reactive ref, `currentAccount`, `login`, `logout`, `refreshAccounts`.

- [ ] **Step 1: Implement account store**

Create `src/renderer/store/account.ts`:

```typescript
import { ref, computed } from '@common/utils/vueTools'
import { getAccounts, saveAccount, removeAccount } from '@renderer/utils/ipc'

export const accounts = ref<LX.Account.PlatformAccount[]>([])
export const currentAccountId = ref<string | null>(null)

export const currentAccount = computed(() =>
  accounts.value.find(a => a.id === currentAccountId.value) ?? null
)

export const loadAccounts = async () => {
  accounts.value = await getAccounts()
}

export const addAccount = async (account: LX.Account.PlatformAccount) => {
  await saveAccount(account)
  await loadAccounts()
}

export const deleteAccount = async (id: string) => {
  await removeAccount(id)
  await loadAccounts()
}
```

- [ ] **Step 2: Add IPC wrappers**

Modify `src/renderer/utils/ipc.ts` to add:

```typescript
export const getAccounts = (): Promise<LX.Account.PlatformAccount[]> =>
  rendererInvoke<LX.Account.PlatformAccount[]>(IPCMusicNames.account_list)

export const saveAccount = (account: LX.Account.PlatformAccount): Promise<void> =>
  rendererInvoke<void>(IPCMusicNames.account_save, account)

export const removeAccount = (id: string): Promise<void> =>
  rendererInvoke<void>(IPCMusicNames.account_remove, id)
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/account.ts src/renderer/utils/ipc.ts
git commit -m "feat(account): add renderer account store and IPC wrappers"
```

---

## Task 5: 登录弹窗 UI

**Files:**
- Create: `src/renderer/views/Setting/components/AccountModal.vue`
- Modify: `src/renderer/views/Setting/components/SettingBasic.vue`
- Modify: `src/lang/zh-cn.json`（添加文案）

**Interfaces:**
- Consumes: `accountStore`, `wy.login.loginByCookie`.
- Produces: UI for selecting platform and pasting cookie/token to log in.

- [ ] **Step 1: Create AccountModal.vue**

A simple modal with:
- Platform selector (首期仅 wy）
- Cookie textarea
- Login button
- Error display

```vue
<template lang="pug">
modal(v-model="visible" :title="$t('account__login_title')")
  .content
    base-select(v-model="form.source" :list="sourceList")
    textarea(v-model="form.cookie" :placeholder="$t('account__cookie_placeholder')")
    base-btn(:disabled="!form.cookie" @click="handleLogin") {{ $t('account__login') }}
    .error(v-if="error") {{ error }}
</template>
```

- [ ] **Step 2: Add entry in SettingBasic**

Add a row: "账号管理" → opens `AccountModal`.

- [ ] **Step 3: Add i18n strings**

In `src/lang/zh-cn.json`:

```json
{
  "account__login_title": "登录音乐平台账号",
  "account__cookie_placeholder": "粘贴 Cookie（例如 MUSIC_U=xxx; __csrf=yyy）",
  "account__login": "登录"
}
```

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/Setting/components/AccountModal.vue src/renderer/views/Setting/components/SettingBasic.vue src/lang/zh-cn.json
git commit -m "feat(ui): add platform account login modal"
```

---

## Task 6: 平台歌单同步入口

**Files:**
- Modify: `src/renderer/views/List/MyList/index.vue`
- Modify: `src/renderer/views/List/MyList/useMenu.js` 或新增菜单项
- Modify: `src/renderer/store/list/action.ts`

**Interfaces:**
- Consumes: `accountStore.currentAccount`, `musicSdk[source].user.getUserPlaylists`.
- Produces: menu action "同步平台歌单" that creates/updates local user lists bound to platform lists.

- [ ] **Step 1: Add sync action**

In `src/renderer/store/list/action.ts`:

```typescript
export const syncPlatformPlaylists = async (source: LX.Account.Source) => {
  const account = accountStore.currentAccount.value
  if (!account || account.source !== source) throw new Error('未登录')

  // Get session from main process (or use IPC to proxy request)
  const playlists = await musicSdk[source]?.user?.getUserPlaylists(account, 1)
  // Match against existing user lists by sourceListId
  for (const playlist of playlists) {
    const existing = userLists.find(l => l.sourceListId === playlist.id && l.source === source)
    if (existing) {
      await updateUserList({ ...existing, name: playlist.name })
    } else {
      await createUserList({
        name: playlist.name,
        source,
        sourceListId: playlist.id,
      })
    }
  }
}
```

- [ ] **Step 2: Add menu item**

In `src/renderer/views/List/MyList/useMenu.js` add "同步我的歌单" when an account for that source is logged in.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/list/action.ts src/renderer/views/List/MyList/useMenu.js src/renderer/views/List/MyList/index.vue
git commit -m "feat(list): add sync platform playlists action"
```

---

## Task 7: 每日推荐视图

**Files:**
- Create: `src/renderer/views/DailyRecommend/index.vue`
- Modify: `src/renderer/router/index.ts`（若存在）或主界面侧边栏入口
- Modify: `src/renderer/core/useApp/useView/index.ts`（若视图路由在此处管理）

**Interfaces:**
- Consumes: `accountStore.currentAccount`, `musicSdk.wy.user.getDailyRecommend`.
- Produces: A view that loads daily recommend songs into the player/temp list.

- [ ] **Step 1: Create view**

A simple view with a source selector and "播放每日推荐" button:

```vue
<template lang="pug">
.daily-recommend
  h2 {{ $t('daily_recommend__title') }}
  base-select(v-model="selectedSource" :list="sourceOptions")
  base-btn(@click="loadDaily") {{ $t('daily_recommend__load') }}
</template>
```

- [ ] **Step 2: Add route/entry**

Add sidebar entry "每日推荐" that navigates to the view.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/views/DailyRecommend/index.vue src/renderer/router/index.ts src/renderer/components/layout/Aside.vue

git commit -m "feat(ui): add daily recommend view"
```

---

## Task 8: 歌单详情内增删歌曲

**Files:**
- Modify: `src/renderer/views/songList/Detail/action.ts`
- Modify: `src/renderer/views/songList/Detail/components/MusicList/useMenu.js`

**Interfaces:**
- Consumes: `listDetailInfo.source`, `listDetailInfo.id`, selected song `songmid`.
- Produces: context menu items "添加到平台歌单" / "从平台歌单移除" that call `musicSdk[source].user.addToPlaylist` / `removeFromPlaylist`.

- [ ] **Step 1: Add platform CRUD actions**

In `src/renderer/views/songList/Detail/action.ts`:

```typescript
export const addSongToPlatformList = async (source: LX.OnlineSource, listId: string, songId: string) => {
  await musicSdk[source]?.user?.addToPlaylist(accountStore.currentAccount.value!, listId, songId)
}

export const removeSongFromPlatformList = async (source: LX.OnlineSource, listId: string, songId: string) => {
  await musicSdk[source]?.user?.removeFromPlaylist(accountStore.currentAccount.value!, listId, songId)
}
```

- [ ] **Step 2: Add context menu items**

Only show when `source` is logged-in platform account and the list belongs to that account.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/views/songList/Detail/action.ts src/renderer/views/songList/Detail/components/MusicList/useMenu.js
git commit -m "feat(ui): add platform playlist add/remove context menu"
```

---

## Task 9: 集成测试与验证

**Files:**
- Create: `scripts/verify-account-flow.js`

- [ ] **Step 1: End-to-end smoke test**

Manual test checklist:

1. Open Settings → Account → login with NetEase cookie.
2. Verify account card shows nickname/avatar.
3. Go to My List → sync platform playlists.
4. Open a synced playlist, confirm songs load.
5. Add a song to the playlist from search results.
6. Remove a song from the playlist.
7. Open Daily Recommend view, load and play.
8. Restart app, confirm login state persists and token remains encrypted in `account_sessions.json`.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

- [ ] **Step 3: Run dev build**

```bash
npm run dev
```

Expected: app starts without runtime errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-account-flow.js
git commit -m "docs: add account feature verification checklist"
```

---

## 后续迭代

- **Task 10:** QQ 音乐登录适配（二维码 / Cookie）+ 用户歌单 + CRUD + 每日推荐。
- **Task 11:** 酷狗音乐登录适配 + 用户歌单 + CRUD + 每日推荐。
- **Task 12:** 将账号协议暴露给 UserApi，让自定义源也能接入登录/歌单能力。
- **Task 13:** 支持扫码登录（网易已可用二维码方案）与短信登录（QQ/酷狗）。
