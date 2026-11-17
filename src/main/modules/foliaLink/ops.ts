// 「Folia 对接」的接口白名单与参数校验，以及分享歌单链接的平台识别。
// 不碰 electron，测试里直接调用。参数不合格时抛 LinkError('invalid-params')，由服务转成 400。

export class LinkError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 在渲染进程里执行的接口（搜索、歌单、取歌词封面、播放控制都在那边） */
export const RENDERER_OPS = [
  'info', 'search', 'songlistSearch', 'songlistDetail', 'songlistAll', 'songlistCollect', 'lyric', 'pic', 'play', 'control', 'queue',
  'accountLists', 'accountListMusics',
] as const
/** 主进程直接回答的接口（我的列表在主进程的数据库里） */
export const MAIN_OPS = ['state', 'lists', 'listMusics', 'listAdd', 'listRemove', 'likedIds'] as const

export type RendererOp = typeof RENDERER_OPS[number]
export type MainOp = typeof MAIN_OPS[number]
export type LinkOp = RendererOp | MainOp

export const PLAY_MODES = ['listLoop', 'random', 'list', 'singleLoop', 'none'] as const
export const QUALITIES = ['128k', '320k', 'flac', 'hires', 'atmos', 'atmos_plus', 'master'] as const
export const SONGLIST_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'] as const
const CONTROL_ACTIONS = ['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'mute', 'rate', 'playMode', 'quality'] as const
const PLAY_TARGETS = ['list', 'search', 'songlist', 'later', 'queue'] as const

const MAX_TEXT = 2000
const MAX_BATCH = 1000

export const isLinkOp = (op: unknown): op is LinkOp => typeof op == 'string' && ((RENDERER_OPS as readonly string[]).includes(op) || (MAIN_OPS as readonly string[]).includes(op))
export const isRendererOp = (op: LinkOp): op is RendererOp => (RENDERER_OPS as readonly string[]).includes(op)

const fail = (message: string): never => { throw new LinkError('invalid-params', message) }
const isObject = (value: unknown): value is Record<string, any> => typeof value == 'object' && value != null && !Array.isArray(value)
const text = (value: unknown, name: string, max = MAX_TEXT) => {
  if (typeof value != 'string' || !value.trim() || value.length > max) fail(`${name} must be a non-empty string`)
  return (value as string).trim()
}
const optionalText = (value: unknown, name: string, max = MAX_TEXT) => value == null || value === '' ? undefined : text(value, name, max)
const integer = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value != 'number' || !Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer in ${min}..${max}`)
  return value as number
}
const finite = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value != 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} must be a number in ${min}..${max}`)
  return value as number
}
const oneOf = <T extends string>(value: unknown, list: readonly T[], name: string): T => {
  if (typeof value != 'string' || !(list as readonly string[]).includes(value)) fail(`${name} must be one of ${list.join(', ')}`)
  return value as T
}

/** 歌曲信息只做浅校验：结构由落雪自己的列表与播放代码使用 */
export const checkMusicInfo = (value: unknown, name = 'musicInfo'): LX.Music.MusicInfo => {
  if (!isObject(value)) return fail(`${name} must be an object`)
  if (typeof value.id != 'string' || !value.id || typeof value.name != 'string' || typeof value.source != 'string' || !isObject(value.meta)) {
    fail(`${name} is not a music info`)
  }
  return value as unknown as LX.Music.MusicInfo
}

const checkMusicInfos = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.length > MAX_BATCH) fail(`${name} must be an array of at most ${MAX_BATCH}`)
  return (value as unknown[]).map((item, index) => checkMusicInfo(item, `${name}[${index}]`))
}

/** 校验并整理一个接口的参数；返回的对象只含认识的字段 */
export const checkParams = (op: LinkOp, raw: unknown): Record<string, any> => {
  const params = raw ?? {}
  if (!isObject(params)) fail('params must be an object')
  const p = params as Record<string, any>
  switch (op) {
    case 'info':
    case 'queue':
    case 'state':
    case 'lists':
    case 'likedIds':
    case 'accountLists':
      return {}
    case 'search':
      return { text: text(p.text, 'text', 200), source: text(p.source, 'source', 20), page: integer(p.page ?? 1, 'page', 1, 1000) }
    // 按关键词搜歌单：source 是一个平台或 all
    case 'songlistSearch':
      return { text: text(p.text, 'text', 200), source: text(p.source, 'source', 20), page: integer(p.page ?? 1, 'page', 1, 1000) }
    // 平台账号的一张歌单（playlistId，有的平台还要 dirId），或它的每日推荐（daily）
    case 'accountListMusics': {
      const accountId = text(p.accountId, 'accountId', 200)
      if (p.daily === true) return { accountId, daily: true }
      return { accountId, playlistId: text(p.playlistId, 'playlistId', 500), dirId: optionalText(p.dirId, 'dirId', 500) }
    }
    case 'songlistDetail':
      return { text: text(p.text, 'text'), source: optionalText(p.source, 'source', 20), page: integer(p.page ?? 1, 'page', 1, 10000) }
    case 'songlistAll':
      return { text: text(p.text, 'text'), source: optionalText(p.source, 'source', 20) }
    case 'songlistCollect':
      return { text: text(p.text, 'text'), source: optionalText(p.source, 'source', 20), name: optionalText(p.name, 'name', 200) }
    case 'lyric':
    case 'pic':
      return { musicInfo: checkMusicInfo(p.musicInfo) }
    case 'listMusics':
      return { listId: text(p.listId, 'listId', 200) }
    case 'listAdd':
      return { listId: text(p.listId, 'listId', 200), musicInfos: checkMusicInfos(p.musicInfos, 'musicInfos') }
    case 'listRemove': {
      if (!Array.isArray(p.ids) || p.ids.length > MAX_BATCH || p.ids.some((id: unknown) => typeof id != 'string' || !id)) fail('ids must be an array of strings')
      return { listId: text(p.listId, 'listId', 200), ids: p.ids as string[] }
    }
    case 'play': {
      const target = oneOf(p.target, PLAY_TARGETS, 'target')
      switch (target) {
        case 'list': return { target, listId: text(p.listId, 'listId', 200), musicId: text(p.musicId, 'musicId', 500) }
        case 'search': return { target, musicInfo: checkMusicInfo(p.musicInfo) }
        // Folia 自己排的队列（打乱、筛过、加过歌）：放进临时列表，从 musicId 这首开始
        case 'queue': {
          const musicInfos = checkMusicInfos(p.musicInfos, 'musicInfos')
          if (!musicInfos.length) fail('musicInfos must not be empty')
          return { target, musicInfos, musicId: text(p.musicId, 'musicId', 500) }
        }
        // 稍后播放：一首（musicInfo）或几首（musicInfos），top 为 false 时排在稍后播放的最后，否则排在最前；
        // now 为 true 时排到最前并马上播放第一首（在 Folia 的队列里点了一首稍后播放的歌）
        case 'later': {
          const musicInfos = p.musicInfos === undefined ? [checkMusicInfo(p.musicInfo)] : checkMusicInfos(p.musicInfos, 'musicInfos')
          if (!musicInfos.length) fail('musicInfos must not be empty')
          if (p.top !== undefined && typeof p.top != 'boolean') fail('top must be a boolean')
          if (p.now !== undefined && typeof p.now != 'boolean') fail('now must be a boolean')
          const now = p.now === true
          return { target, musicInfos, top: now || p.top !== false, now }
        }
        case 'songlist': return {
          target,
          text: text(p.text, 'text'),
          source: optionalText(p.source, 'source', 20),
          musicId: optionalText(p.musicId, 'musicId', 500),
        }
      }
      break
    }
    case 'control': {
      const action = oneOf(p.action, CONTROL_ACTIONS, 'action')
      switch (action) {
        case 'seek': return { action, value: finite(p.value, 'value', 0, 7 * 24 * 3600) }
        case 'volume': return { action, value: finite(p.value, 'value', 0, 1) }
        case 'mute':
          if (typeof p.value != 'boolean') fail('value must be a boolean')
          return { action, value: p.value as boolean }
        case 'rate': return { action, value: finite(p.value, 'value', 0.5, 2) }
        case 'playMode': return { action, value: oneOf(p.value, PLAY_MODES, 'value') }
        case 'quality': return { action, value: oneOf(p.value, QUALITIES, 'value') }
        default: return { action }
      }
    }
  }
  return fail(`unknown op ${op as string}`)
}

/** 从分享文案里取出第一条链接；没有链接时原样返回（可能就是歌单 ID） */
export const extractSongListText = (input: string) => {
  const match = /https?:\/\/[^\s"'<>，。、）)】]+/i.exec(input)
  return match ? match[0] : input.trim()
}

const HOST_SOURCES: Array<[RegExp, typeof SONGLIST_SOURCES[number]]> = [
  [/(^|\.)(music\.)?163\.com$|(^|\.)163cn\.tv$|(^|\.)music\.126\.net$/i, 'wy'],
  [/(^|\.)qq\.com$|(^|\.)url\.cn$|(^|\.)tencentmusic\.com$/i, 'tx'],
  [/(^|\.)kugou\.com$/i, 'kg'],
  [/(^|\.)kuwo\.cn$|(^|\.)bodian\.cn$/i, 'kw'],
  [/(^|\.)migu\.cn$/i, 'mg'],
]

/** 按链接的域名认平台；认不出（或只是 ID）时回 null，需要调用方给出平台 */
export const detectSongListSource = (input: string): typeof SONGLIST_SOURCES[number] | null => {
  const link = extractSongListText(input)
  let host: string
  try {
    host = new URL(link).hostname
  } catch {
    return null
  }
  for (const [pattern, source] of HOST_SOURCES) if (pattern.test(host)) return source
  return null
}

/** 分享歌单的平台：参数给了就用参数（须是支持的平台），否则按链接认 */
export const resolveSongListSource = (input: string, source?: string) => {
  if (source) return oneOf(source, SONGLIST_SOURCES, 'source')
  const detected = detectSongListSource(input)
  if (!detected) throw new LinkError('unknown-source', 'Cannot tell the platform of this link; pick one')
  return detected
}
