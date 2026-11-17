// 「Folia 对接」的播放状态：渲染进程推来的状态在这里合并，Folia 来问时按收到的时刻把播放位置外推到现在；
// 列表的变化（主进程 event_list）在这里记成版本号，Folia 看版本号变了才重读队列和列表。
// 不碰 electron，测试里直接调用。

export interface RendererPlayerState {
  musicId: string | null
  musicInfo: LX.Music.MusicInfo | null
  listId: string | null
  isTempPlay: boolean
  playLaterCount: number
  isPlay: boolean
  loading: boolean
  positionMs: number
  durationMs: number
  rate: number
  volume: number
  mute: boolean
  playMode: string
  quality: { wanted: string, current: string, actual: string }
}

export interface LinkPlayerState extends RendererPlayerState {
  /** 正在播放的列表换了、它的内容变了、稍后播放变了：Folia 重读队列 */
  queueRev: number
  /** 我的列表有任何变化（新建、改名、删除、歌曲增删） */
  listsRev: number
  /** 「我的收藏」的歌曲变了：Folia 重读喜欢的歌 */
  loveRev: number
  /** 这份状态对应的时刻（Date.now） */
  at: number
}

export const LOVE_LIST_ID = 'love'

export const emptyRendererState = (): RendererPlayerState => ({
  musicId: null,
  musicInfo: null,
  listId: null,
  isTempPlay: false,
  playLaterCount: 0,
  isPlay: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  volume: 1,
  mute: false,
  playMode: 'listLoop',
  quality: { wanted: '', current: '', actual: '' },
})

/** 会让 Folia 立即知道的字段：位置的正常前进不算 */
const DISCRETE_KEYS = ['musicId', 'listId', 'isTempPlay', 'playLaterCount', 'isPlay', 'loading', 'durationMs', 'rate', 'volume', 'mute', 'playMode'] as const

export const createLinkState = ({ now }: { now: () => number }) => {
  let renderer = emptyRendererState()
  let receivedAt = now()
  let queueRev = 1
  let listsRev = 1
  let loveRev = 1
  let lastQualityKey = ''

  /** 从收到上一份起按时间走到 at 的位置（播放中、不在加载），不超过时长 */
  const positionAt = (at: number) => {
    let positionMs = renderer.positionMs
    if (renderer.isPlay && !renderer.loading) {
      positionMs += Math.max(0, at - receivedAt) * renderer.rate
      if (renderer.durationMs > 0) positionMs = Math.min(positionMs, renderer.durationMs)
    }
    return positionMs
  }

  /** 合并渲染进程推来的一份（可以只含变了的字段）；回 true 表示有 Folia 要马上知道的变化 */
  const update = (patch: Partial<RendererPlayerState>) => {
    const prev = renderer
    const at = now()
    // 不带位置的一份（音量、模式…）：位置先按时间走到现在，免得外推从旧位置重新算起而往回跳
    const expected = positionAt(at)
    renderer = { ...renderer, ...patch, quality: { ...renderer.quality, ...patch.quality } }
    if (!('positionMs' in patch)) renderer.positionMs = expected
    receivedAt = at
    let discrete = DISCRETE_KEYS.some(key => prev[key] !== renderer[key])
    if (prev.listId !== renderer.listId || prev.isTempPlay !== renderer.isTempPlay || prev.playLaterCount !== renderer.playLaterCount) queueRev++
    const qualityKey = `${renderer.quality.wanted}|${renderer.quality.current}|${renderer.quality.actual}`
    if (qualityKey !== lastQualityKey) {
      lastQualityKey = qualityKey
      discrete = true
    }
    // 拖动：位置跳了（不是按时间正常走过去的）
    if (!discrete && 'positionMs' in patch && Math.abs(renderer.positionMs - expected) > 1500) discrete = true
    return discrete
  }

  /** 列表变了（主进程 event_list 的事件）；回 true 表示正在播放的队列受影响 */
  const listsChanged = (listIds: string[] | null) => {
    listsRev++
    if (listIds == null || listIds.includes(LOVE_LIST_ID)) loveRev++
    if (listIds == null || (renderer.listId != null && listIds.includes(renderer.listId))) {
      queueRev++
      return true
    }
    return false
  }

  /** 现在的状态：播放中按收到后经过的时间外推位置，不超过时长 */
  const read = (): LinkPlayerState => {
    const at = now()
    return { ...renderer, quality: { ...renderer.quality }, positionMs: Math.round(positionAt(at)), queueRev, listsRev, loveRev, at }
  }

  return { update, listsChanged, read }
}
