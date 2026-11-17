// 「Folia 对接」：给 Folia（落雪对接分支）一个本机接口，让它在 Folia 里搜歌、看我的列表、打开分享的歌单、
// 控制播放；播放仍由本软件完成（音源、音质、播放引擎、输出设备照常生效），Folia 跟着显示歌词。
// 服务在 server.ts，接口白名单在 ops.ts，状态在 state.ts，问渲染进程在 rendererRpc.ts，连接文件在 connection.ts；
// 渲染进程一侧在 renderer/core/useApp/useFoliaLink。
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { log } from '@common/utils'
import { mainHandle, mainOn } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { LIST_IDS } from '@common/constants'
import { isExistWindow, sendEvent } from '@main/modules/winMain'
import { resolveSystemAppDataDir } from '../foliaStage/connection'
import { buildFoliaLyricContent } from '../foliaStage/lyric'
import { resolveFoliaCover } from '../foliaStage/cover'
import { buildLinkConnectionInfo, removeLinkConnectionFile, removeLinkConnectionFileSync, resolveLinkFilePath, writeLinkConnectionFile } from './connection'
import { checkParams, extractSongListText, isLinkOp, isRendererOp, LinkError, resolveSongListSource, type MainOp } from './ops'
import { createLinkState, type RendererPlayerState } from './state'
import { createRendererRpc, type RendererRpcResponse } from './rendererRpc'
import { createLinkServer } from './server'
import { setFoliaLinkClientActive } from './presence'

export interface FoliaLinkStatus {
  state: 'disabled' | 'waiting' | 'connected'
  port: number | null
}

/** 状态变化推给 Folia 前的合并窗口：换歌时几个字段常常一连几条 */
const STATE_PUSH_DEBOUNCE_MS = 40
/** 列表变化的合并窗口：导入歌单时一连串增删 */
const LISTS_PUSH_DEBOUNCE_MS = 200
const PRESENCE_POLL_MS = 2000

/** 各接口问渲染进程的时限 */
const RPC_TIMEOUTS: Partial<Record<string, number>> = {
  search: 30_000,
  songlistSearch: 30_000,
  accountLists: 60_000,
  // QQ 音乐的歌单要逐首取详情，几百首要一会儿
  accountListMusics: 180_000,
  songlistDetail: 30_000,
  songlistAll: 180_000,
  songlistCollect: 180_000,
  play: 60_000,
  lyric: 30_000,
  pic: 20_000,
}

const LIST_EVENTS = [
  'list_data_overwrite', 'list_create', 'list_remove', 'list_update', 'list_update_position',
  'list_music_overwrite', 'list_music_add', 'list_music_move', 'list_music_remove', 'list_music_update',
] as const

let isRegistered = false
export default () => {
  if (isRegistered) return
  isRegistered = true

  const pid = process.pid
  const linkFilePath = resolveLinkFilePath({
    platform: process.platform,
    env: process.env,
    appDataDir: resolveSystemAppDataDir({ platform: process.platform, env: process.env }),
  })
  const logLine = (level: 'info' | 'warn', message: string, detail?: unknown) => {
    if (detail === undefined) log[level](message)
    else log[level](message, detail)
  }

  const linkState = createLinkState({ now: () => Date.now() })
  const rpc = createRendererRpc({
    send: request => {
      if (!isExistWindow()) return false
      sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.folia_link_request, request)
      return true
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: handle => { clearTimeout(handle as NodeJS.Timeout) },
  })

  let server: ReturnType<typeof createLinkServer> | null = null
  let starting: Promise<void> | null = null
  let statePushTimer: NodeJS.Timeout | null = null
  let listsPushTimer: NodeJS.Timeout | null = null

  const pushState = () => {
    if (statePushTimer) return
    statePushTimer = setTimeout(() => {
      statePushTimer = null
      server?.broadcast('state', linkState.read())
    }, STATE_PUSH_DEBOUNCE_MS)
  }
  const pushLists = () => {
    if (listsPushTimer) return
    listsPushTimer = setTimeout(() => {
      listsPushTimer = null
      const state = linkState.read()
      server?.broadcast('lists', { listsRev: state.listsRev, loveRev: state.loveRev, queueRev: state.queueRev })
    }, LISTS_PUSH_DEBOUNCE_MS)
  }

  /** Folia 只能改试听列表、我的收藏和还在的自建列表（Folia 记着的列表可能已经在这边删了） */
  const assertWritableList = async(listId: string) => {
    if (listId == LIST_IDS.DEFAULT || listId == LIST_IDS.LOVE) return
    const userLists = await global.lx.worker.dbService.getAllUserList()
    if (!userLists.some(list => list.id == listId)) throw new LinkError('not-found', 'That list does not exist')
  }

  /** 主进程直接回答的接口：我的列表在主进程的数据库里 */
  const handleMainOp = async(op: MainOp, params: Record<string, any>) => {
    const db = global.lx.worker.dbService
    switch (op) {
      case 'state':
        return linkState.read()
      case 'lists': {
        const userLists = await db.getAllUserList()
        const lists = [
          { id: LIST_IDS.DEFAULT, name: '试听列表', kind: 'default' },
          { id: LIST_IDS.LOVE, name: '我的收藏', kind: 'love' },
          ...userLists.map(list => ({ id: list.id, name: list.name, kind: 'user', source: list.source ?? null, sourceListId: list.sourceListId ?? null })),
        ]
        return Promise.all(lists.map(async list => ({ ...list, count: (await db.getListMusics(list.id)).length })))
      }
      case 'listMusics':
        return db.getListMusics(params.listId)
      case 'listAdd':
        await assertWritableList(params.listId)
        await global.lx.event_list.list_music_add(params.listId, params.musicInfos, global.lx.appSetting['list.addMusicLocationType'])
        return null
      case 'listRemove':
        await assertWritableList(params.listId)
        await global.lx.event_list.list_music_remove(params.listId, params.ids)
        return null
      case 'likedIds':
        return (await db.getListMusics(LIST_IDS.LOVE)).map(music => music.id)
    }
  }

  const handleRpc = async(op: unknown, rawParams: unknown) => {
    if (!isLinkOp(op)) throw new LinkError('unknown-op', `Unknown op: ${String(op)}`)
    const params = checkParams(op, rawParams)
    if (!isRendererOp(op)) return handleMainOp(op, params)
    // 分享歌单：先认平台，渲染进程拿到的就是能直接交给平台接口的链接或 ID
    if (op == 'songlistDetail' || op == 'songlistAll' || op == 'songlistCollect' || (op == 'play' && params.target == 'songlist')) {
      params.source = resolveSongListSource(params.text, params.source)
      params.text = extractSongListText(params.text)
    }
    const data = await rpc.request<any>(op, params, RPC_TIMEOUTS[op])
    switch (op) {
      case 'lyric':
        return { content: data ? buildFoliaLyricContent(data) : null }
      case 'pic':
        return data?.url ? await resolveFoliaCover(data.url) : null
      default:
        return data
    }
  }

  const start = async() => {
    const token = randomBytes(32).toString('base64url')
    const instance = createLinkServer({ token, getState: () => linkState.read(), handleRpc, log: logLine, now: () => Date.now() })
    const port = await instance.start()
    // 连接文件写不出来就不算开着：关掉服务，下次开开关时重来
    try {
      await writeLinkConnectionFile(linkFilePath, buildLinkConnectionInfo({ pid, port, token, appVersion: app.getVersion() }))
    } catch (err) {
      await instance.stop()
      throw err
    }
    server = instance
    log.info(`[FoliaLink] listening on 127.0.0.1:${port}`)
  }

  const stop = async() => {
    const instance = server
    server = null
    rpc.cancelAll('Folia link was turned off')
    setFoliaLinkClientActive(false)
    await removeLinkConnectionFile(linkFilePath, pid)
    await instance?.stop()
  }

  // 开关一次次排着做：后一次等前一次做完（快速开关时 stop 不会删掉后一次 start 刚写的连接文件）
  const setEnabled = (enabled: boolean) => {
    const previous = starting ?? Promise.resolve()
    const run: Promise<void> = previous.then(async() => {
      if (enabled && !server) await start()
      else if (!enabled && server) await stop()
    }).catch(err => {
      log.warn('[FoliaLink] could not switch the link', err)
    }).finally(() => {
      if (starting === run) starting = null
    })
    starting = run
  }

  // 渲染进程推来的播放状态；回答 RPC
  mainOn<Partial<RendererPlayerState>>(WIN_MAIN_RENDERER_EVENT_NAME.folia_link_state, ({ params }) => {
    if (!params || typeof params != 'object') return
    if (linkState.update(params)) pushState()
  })
  mainOn<RendererRpcResponse>(WIN_MAIN_RENDERER_EVENT_NAME.folia_link_response, ({ params }) => {
    rpc.handleResponse(params)
  })
  mainHandle<FoliaLinkStatus>(WIN_MAIN_RENDERER_EVENT_NAME.folia_link_status, async(): Promise<FoliaLinkStatus> => {
    if (!server) return { state: 'disabled', port: null }
    return { state: server.isClientActive() ? 'connected' : 'waiting', port: server.getPort() }
  })

  // 列表变了：Folia 按版本号重读
  for (const name of LIST_EVENTS) {
    // 监听函数的类型按 ListEvent 的方法声明是 async 的
    global.lx.event_list.on(name, async(...args: any[]) => {
      let ids: string[] | null = null
      switch (name) {
        case 'list_music_overwrite':
        case 'list_music_add':
        case 'list_music_remove':
          ids = [args[0]]
          break
        case 'list_music_move':
          ids = [args[0], args[1]]
          break
        case 'list_music_update':
          ids = Array.isArray(args[0]) ? args[0].map((item: any) => item?.id).filter(Boolean) : null
          break
        case 'list_create':
        case 'list_update':
        case 'list_update_position':
          ids = []
          break
        case 'list_remove':
          ids = Array.isArray(args[0]) ? args[0] : null
          break
      }
      if (linkState.listsChanged(ids)) pushState()
      pushLists()
    })
  }

  setInterval(() => { setFoliaLinkClientActive(server?.isClientActive() ?? false) }, PRESENCE_POLL_MS).unref()

  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('foliaLink.enable')) setEnabled(!!setting['foliaLink.enable'])
  })
  setEnabled(!!global.lx.appSetting['foliaLink.enable'])

  app.on('before-quit', () => {
    removeLinkConnectionFileSync(linkFilePath, pid)
    void server?.stop()
  })
}
