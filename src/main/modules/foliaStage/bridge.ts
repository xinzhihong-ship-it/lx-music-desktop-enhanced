// Folia 歌词舞台推送的状态机：跟着落雪的播放状态（主进程 player_status 的增量事件），
// 按 Folia Stage API「接入外部播放器」的约定推给 Folia（Folia 仓库 test/manual/stage-client/API_SCHEMA.md）：
//   换歌 → POST /stage/lyrics（曲目、封面、歌词、当前位置）；歌词、封面晚到时再推一次
//   播放、暂停、拖动、倍速、时长变化 → POST /stage/lyrics/clock；播放中隔几秒纠正一次漂移
//   停止播放、关掉推送、退出 → DELETE /stage/state
// Folia 只显示，播放仍在落雪。请求按顺序排队发出，不会出现后发先至。
// 这里只依赖注入的 deps（连接文件、请求、计时器），不碰 electron，测试里直接驱动。
import type { FoliaCover } from './cover'
import { connectionKey, type StageConnection } from './connection'

export interface StageResponse {
  status: number
  body: any
}
export type StageMethod = 'GET' | 'POST' | 'DELETE'
export type StageRequest = (connection: StageConnection, method: StageMethod, pathname: string, body?: unknown) => Promise<StageResponse>

export interface LyricTexts {
  lyric: string
  tlyric: string
  rlyric: string
  lxlyric: string
}

export interface FoliaStageDeps {
  readConnection: () => Promise<StageConnection | null>
  request: StageRequest
  buildLyricContent: (texts: LyricTexts) => string | null
  resolveCover: (picUrl: string) => Promise<FoliaCover | null>
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  log: (level: 'info' | 'warn', message: string, detail?: unknown) => void
}

export type FoliaStageState = 'disabled' | 'waiting' | 'connected'
export interface FoliaStageStatus {
  state: FoliaStageState
  port: number | null
  /** 舞台被 Folia 里的其他来源接管了，等下一首歌再推 */
  detached: boolean
}

type PlayerStatus = Partial<LX.Player.Status>

/** 计时器粒度 */
export const TICK_MS = 250
/** 隔多久重读一次连接文件（Folia 开关 Stage、重新生成 token、退出） */
export const POLL_MS = 2000
/** 连不上 Folia 后多久再试 */
export const RETRY_BACKOFF_MS = 5000
/** 换歌后等歌词多久再推第一次（歌词更早到就提前推） */
export const TRACK_SETTLE_MS = 800
/** 歌词、封面更新的合并窗口 */
export const UPDATE_DEBOUNCE_MS = 150
/** 时钟推送的合并窗口：播放状态、进度常常一连几条 */
export const CLOCK_DEBOUNCE_MS = 80
/** 正常速度时隔多久纠正一次漂移 */
export const DRIFT_MS = 5000
/** 倍速时 Folia 的时钟仍按 1 倍走，推得勤一些 */
export const DRIFT_RATE_MS = 500
/** 进度和推算位置差这么多算拖动 */
export const SEEK_THRESHOLD_MS = 1000

interface Track {
  seq: number
  title: string
  artist: string
  album: string
  picUrl: string
  /** 只认这首歌 lyricUpdated 带来的歌词；换歌时清空，不沿用上一首的翻译 */
  lyric: LyricTexts | null
}

export const createFoliaStageBridge = (deps: FoliaStageDeps) => {
  let enabled = false
  let connection: StageConnection | null = null
  /** 被拒绝或连不上的连接，在 rejectedUntil 之前不再用 */
  let rejectedKey = ''
  let rejectedUntil = 0

  let trackSeq = 0
  let track: Track | null = null
  let durationMs = 0
  const playback = { playing: false, stopped: true, positionMs: 0, sampledAt: 0, rate: 1 }

  /** Folia 上的会话是我们推的哪一首 */
  let session: { updatedAt: number | undefined, trackSeq: number } | null = null
  /** 舞台被其他来源接管时那首歌的 seq：换歌前不再推 */
  let detachedSeq = -1
  /** 上一次推送成功的内容，相同时不重推 */
  let pushedSignature = ''

  let queue: Promise<void> = Promise.resolve()
  let ticker: unknown = null
  let pushTimer: unknown = null
  let pushDue = 0
  let clockTimer: unknown = null
  let lastPollAt = -Infinity
  let lastClockAt = 0
  let statusListener: ((status: FoliaStageStatus) => void) | null = null

  const getStatus = (): FoliaStageStatus => ({
    state: enabled ? connection ? 'connected' : 'waiting' : 'disabled',
    port: connection?.port ?? null,
    detached: !!track && detachedSeq == track.seq,
  })
  let lastStatusKey = ''
  const emitStatus = () => {
    const status = getStatus()
    const key = `${status.state}:${status.port}:${status.detached}`
    if (key == lastStatusKey) return
    lastStatusKey = key
    statusListener?.(status)
  }

  const enqueue = async(task: () => Promise<void>) => {
    queue = queue.then(task).catch(err => { deps.log('warn', '[FoliaStage] 推送出错', err) })
    return queue
  }

  const positionAt = (now: number) => {
    let position = playback.positionMs
    if (playback.playing) position += Math.max(0, now - playback.sampledAt) * playback.rate
    if (durationMs > 0) position = Math.min(position, durationMs)
    return Math.max(0, Math.round(position))
  }
  const reanchor = (now: number) => {
    playback.positionMs = positionAt(now)
    playback.sampledAt = now
  }

  const dropConnection = (conn: StageConnection, reason: string, backoffMs: number, detail?: unknown) => {
    if (connection !== conn) return
    connection = null
    session = null
    rejectedKey = connectionKey(conn)
    rejectedUntil = deps.now() + backoffMs
    deps.log('info', `[FoliaStage] 与 Folia 断开：${reason}`, detail)
    emitStatus()
  }

  /** 发一个请求；连不上、token 不对、Stage 关了时断开连接并返回 null */
  const send = async(method: StageMethod, pathname: string, body?: unknown): Promise<StageResponse | null> => {
    const conn = connection
    if (!conn) return null
    let res: StageResponse
    try {
      res = await deps.request(conn, method, pathname, body)
    } catch (err) {
      dropConnection(conn, '连不上 Stage API', RETRY_BACKOFF_MS, err)
      return null
    }
    // token 不对：等 Folia 改写连接文件（key 会变），同一份连接不再试
    if (res.status == 401) {
      dropConnection(conn, 'token 不匹配', Infinity)
      return null
    }
    if (res.status == 503) {
      dropConnection(conn, 'Folia 的 Stage 模式没开', RETRY_BACKOFF_MS)
      return null
    }
    return res
  }

  const canPush = () => enabled && !!connection && !!track && !playback.stopped && detachedSeq != track.seq

  const runSessionPush = async() => {
    if (!canPush()) return
    const current = track!
    const lyricContent = current.lyric ? deps.buildLyricContent(current.lyric) : null
    let cover: FoliaCover | null = null
    try {
      cover = await deps.resolveCover(current.picUrl)
    } catch {}
    // 读封面期间换了歌：新歌自己会再推
    if (track !== current || !canPush()) return

    // 歌词、封面都没变（如找不到歌词时又来一次空的 lyricUpdated）：不重推，免得舞台重新载入
    const signature = `${current.seq}\n${current.title}\n${current.artist}\n${current.album}\n${durationMs > 0}\n${JSON.stringify(cover)}\n${lyricContent ?? ''}`
    if (session?.trackSeq == current.seq && signature == pushedSignature) return

    const body: Record<string, unknown> = {
      title: current.title.trim() || 'LX Music',
      ...(current.artist.trim() ? { artist: current.artist.trim() } : {}),
      ...(current.album.trim() ? { album: current.album.trim() } : {}),
      ...(durationMs > 0 ? { durationMs } : {}),
      ...(lyricContent ? { lyricSource: { type: 'local', lrcContent: lyricContent } } : {}),
      ...(cover ?? {}),
    }
    const now = deps.now()
    body.positionMs = positionAt(now)
    body.paused = !playback.playing

    let res = await send('POST', '/stage/lyrics', body)
    // 请求体超出 2 MiB：多半是封面太大，去掉封面再推一次
    if (res?.status == 413 && cover) {
      delete body.cover
      delete body.coverUrl
      res = await send('POST', '/stage/lyrics', body)
    }
    if (!res) return
    if (res.status == 200) {
      // 推送期间又拖动、暂停过：那时已排了一次时钟推送，排在这次之后，按新会话发出。
      // 改 session 的任务都在同一个队列里依次执行，await 期间不会有别的任务改它
      // eslint-disable-next-line require-atomic-updates
      session = { updatedAt: res.body?.lyricsSession?.updatedAt, trackSeq: current.seq }
      // eslint-disable-next-line require-atomic-updates
      pushedSignature = signature
      lastClockAt = now
      return
    }
    deps.log('warn', `[FoliaStage] 推送歌曲被拒绝：${res.status}`, res.body)
  }

  const runClockPush = async() => {
    if (!canPush() || !session || session.trackSeq != track!.seq || pushDue) return
    const current = session
    const now = deps.now()
    const res = await send('POST', '/stage/lyrics/clock', {
      positionMs: positionAt(now),
      paused: !playback.playing,
      ...(durationMs > 0 ? { durationMs } : {}),
      ...(current.updatedAt === undefined ? {} : { sessionUpdatedAt: current.updatedAt }),
    })
    if (!res) return
    if (res.status == 200) {
      lastClockAt = now
      return
    }
    if (res.status == 409) {
      // 舞台上已经不是我们推的这首（Folia 里换了来源、清空了舞台，或别的程序推了歌）：
      // 不和它抢，等落雪换歌再推
      if (session === current) {
        session = null
        detachedSeq = track?.seq ?? -1
        deps.log('info', `[FoliaStage] 舞台已被其他来源接管（${res.body?.code ?? 409}），下一首歌再推送`)
        emitStatus()
      }
      return
    }
    deps.log('warn', `[FoliaStage] 时钟推送被拒绝：${res.status}`, res.body)
  }

  const runClear = async() => {
    if (!session) return
    session = null
    await send('DELETE', '/stage/state')
  }

  const pollConnection = async() => {
    if (!enabled) return
    let next: StageConnection | null = null
    try {
      next = await deps.readConnection()
    } catch {}
    const key = connectionKey(next)
    if (key == connectionKey(connection)) return
    if (!next) {
      if (connection) {
        connection = null
        session = null
        deps.log('info', '[FoliaStage] Folia 的 Stage API 已关闭')
        emitStatus()
      }
      return
    }
    if (key == rejectedKey && deps.now() < rejectedUntil) return

    // 先确认 token 有效、Stage 真的开着，再算连上
    connection = next
    session = null
    const res = await send('GET', '/stage/status')
    if (!res) return
    if (res.status != 200) {
      dropConnection(next, `Stage API 返回 ${res.status}`, RETRY_BACKOFF_MS)
      return
    }
    detachedSeq = -1
    deps.log('info', `[FoliaStage] 已连接 Folia Stage API（端口 ${next.port}）`)
    emitStatus()
    if (track && !playback.stopped) setPush(0)
  }

  const setPush = (delay: number) => {
    if (pushTimer) deps.clearTimeout(pushTimer)
    pushDue = deps.now() + delay
    pushTimer = deps.setTimeout(() => {
      pushTimer = null
      pushDue = 0
      void enqueue(runSessionPush)
    }, delay)
  }
  const cancelPush = () => {
    if (pushTimer) deps.clearTimeout(pushTimer)
    pushTimer = null
    pushDue = 0
  }

  function scheduleClock() {
    if (clockTimer) return
    clockTimer = deps.setTimeout(() => {
      clockTimer = null
      void enqueue(runClockPush)
    }, CLOCK_DEBOUNCE_MS)
  }

  const tick = () => {
    ticker = deps.setTimeout(tick, TICK_MS)
    const now = deps.now()
    if (now - lastPollAt >= POLL_MS) {
      lastPollAt = now
      void enqueue(pollConnection)
    }
    if (session && track && session.trackSeq == track.seq && playback.playing && !pushDue && !clockTimer) {
      // 落在离到期最近的那一拍上；纠正漂移不必再合并，直接排队
      if (now - lastClockAt >= (playback.rate == 1 ? DRIFT_MS : DRIFT_RATE_MS) - TICK_MS / 2) {
        lastClockAt = now
        void enqueue(runClockPush)
      }
    }
  }

  const startTrack = (status: PlayerStatus) => {
    trackSeq += 1
    track = {
      seq: trackSeq,
      title: status.name ?? '',
      artist: status.singer ?? '',
      album: status.albumName ?? '',
      picUrl: status.picUrl ?? '',
      lyric: null,
    }
    playback.stopped = false
  }

  const readLyric = (status: PlayerStatus): LyricTexts => ({
    lyric: status.lyric ?? '',
    tlyric: status.tlyric ?? '',
    rlyric: status.rlyric ?? '',
    lxlyric: status.lxlyric ?? '',
  })

  /** 主进程 player_status 的一条增量 */
  const handleStatus = (status: PlayerStatus) => {
    const now = deps.now()
    let clockChanged = false

    if (typeof status.playbackRate == 'number' && status.playbackRate > 0 && status.playbackRate != playback.rate) {
      reanchor(now)
      playback.rate = status.playbackRate
      clockChanged = true
    }
    if ('duration' in status) {
      const next = Math.max(0, Math.round((status.duration ?? 0) * 1000))
      if (next != durationMs) {
        durationMs = next
        clockChanged = true
      }
    }
    if ('progress' in status) {
      const next = Math.max(0, Math.round((status.progress ?? 0) * 1000))
      const expected = positionAt(now)
      playback.positionMs = next
      playback.sampledAt = now
      if (Math.abs(next - expected) > SEEK_THRESHOLD_MS) clockChanged = true
    }
    if (status.status) {
      reanchor(now)
      const playing = status.status == 'playing'
      if (playing != playback.playing) clockChanged = true
      playback.playing = playing
      if (status.status == 'stoped') {
        // 列表放完、没有当前歌曲：舞台回到等待状态
        playback.stopped = true
        track = null
        cancelPush()
        void enqueue(runClear)
        emitStatus()
        return
      }
    }

    if ('name' in status) {
      startTrack(status)
      setPush(TRACK_SETTLE_MS)
      emitStatus()
    }
    if ('lxlyric' in status && track) {
      // lyricUpdated：四份歌词一起到（换歌后首次加载、切换歌词来源、调整偏移）
      const hasLyric = !!status.lyric?.trim() || !!status.lxlyric?.trim()
      track.lyric = hasLyric ? readLyric(status) : null
      setPush(UPDATE_DEBOUNCE_MS)
    } else if (!('name' in status) && 'picUrl' in status && track && (status.picUrl ?? '') != track.picUrl) {
      track.picUrl = status.picUrl ?? ''
      // 第一次推送还没发出时等它一起带上
      if (!pushDue) setPush(UPDATE_DEBOUNCE_MS)
    }

    if (clockChanged && !pushDue) scheduleClock()
  }

  /** 开启时用主进程当前的播放状态补齐（歌曲中途开启推送） */
  const seed = (status: LX.Player.Status) => {
    const now = deps.now()
    playback.playing = status.status == 'playing'
    playback.positionMs = Math.max(0, Math.round(status.progress * 1000))
    playback.sampledAt = now
    playback.rate = status.playbackRate > 0 ? status.playbackRate : 1
    durationMs = Math.max(0, Math.round(status.duration * 1000))
    if (status.status == 'stoped' || !status.name) {
      playback.stopped = true
      track = null
      return
    }
    startTrack(status)
    // 换歌后、歌词加载前，主进程里的翻译等几份可能还是上一首的：原文为空时当作还没有歌词
    if (status.lyric) track!.lyric = readLyric(status)
  }

  const setEnabled = (value: boolean, snapshot?: LX.Player.Status) => {
    if (value == enabled) return
    if (value) {
      enabled = true
      if (snapshot) seed(snapshot)
      detachedSeq = -1
      rejectedKey = ''
      lastPollAt = -Infinity
      tick()
      emitStatus()
      return
    }
    if (ticker) deps.clearTimeout(ticker)
    ticker = null
    cancelPush()
    if (clockTimer) deps.clearTimeout(clockTimer)
    clockTimer = null
    // 先停推送；清空舞台的请求仍在队列里按顺序发出（排在已经排队的推送之后）
    enabled = false
    void enqueue(async() => {
      await runClear()
      if (!enabled) connection = null
    })
    emitStatus()
  }

  /** 退出：尽力清空舞台，不等结果 */
  const shutdown = () => {
    cancelPush()
    if (ticker) deps.clearTimeout(ticker)
    ticker = null
    if (!session || !connection) return
    const conn = connection
    session = null
    void deps.request(conn, 'DELETE', '/stage/state').catch(() => {})
  }

  return {
    handleStatus,
    setEnabled,
    shutdown,
    getStatus,
    onStatus(listener: (status: FoliaStageStatus) => void) {
      statusListener = listener
    },
    /** 测试用：等队列里的请求发完 */
    flush: async() => queue,
  }
}

export type FoliaStageBridge = ReturnType<typeof createFoliaStageBridge>
