import { ref, computed, watch } from '@common/utils/vueTools'
import { musicInfo } from './state'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { getResourceSrc, getCurrentTime, onTimeupdate } from '@renderer/plugins/player'
import {
  openNativeSongKeyWindow,
  closeNativeSongKeyWindow,
  syncNativeSongKeyData,
  onSongKeyWindowSaveAction,
  onSongKeyWindowResetAction,
  onSongKeyWindowReanalyzeAction,
  onSongKeyWindowTogglePluginSync,
  onSongKeyWindowSetRetuneSpeed,
} from '@renderer/utils/ipc'
import {
  resolveSongKey,
  resolveSongKeySync,
  setUserKey,
  clearUserKey,
  getSavedUserKey,
  saveAnalyzedKey,
  setUserKeyTimeline,
  transposeKey,
  getSemitonesFromPlaybackRate,
  analyzeSongAudio,
  segmentAt,
  syncKeyToPlugin,
  sendMidiRetuneSpeed,
  isRetuneSpeedAutomationSupported,
  MIN_CACHEABLE_CONFIDENCE,
  type NoteName,
} from '@renderer/utils/musicKey'

/** 分析相关的时序参数（抽成对象便于测试与调优） */
export const songKeyTiming = {
  /** 歌曲稳定播放多久后才开始分析，1.2秒即可过滤掉极快速的连续切歌，同时保证体感极速出值 */
  analysisDelayMs: 1200,
}

const wait = async(ms: number): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

export const songKeyInfo = ref<LX.SongKey.KeyInfo | null>(null)
export const isKeyAnalyzing = ref(false)

/** 当前播放位置（秒），用于在调性时间轴上定位当前段落 */
export const playbackSeconds = ref(0)

/**
 * 当前实际生效的基调。
 * 有分析时间轴时按播放位置取对应段落 —— 这样主歌转副歌、升 key 都能跟上；
 * 曲库/手动设定是单值，没有时间轴，整首不变。
 */
export const activeSongKey = computed<LX.SongKey.KeyInfo | null>(() => {
  const info = songKeyInfo.value
  if (!info) return null
  const segment = segmentAt(info.timeline, playbackSeconds.value)
  if (!segment) return info
  return {
    ...info,
    key: segment.key,
    scale: segment.scale,
    label: segment.label,
    camelot: segment.camelot,
    confidence: segment.confidence,
  }
})

// Effective song key taking into account pitchShifter playback rate (semitones)
export const effectiveSongKey = computed(() => {
  const base = activeSongKey.value
  if (!base) return null
  const playbackRate = appSetting['player.soundEffect.pitchShifter.playbackRate'] ?? 1
  const semitones = getSemitonesFromPlaybackRate(playbackRate)
  if (semitones === 0) return base

  const transposed = transposeKey(
    base.key as NoteName,
    base.scale,
    semitones,
  )
  return {
    ...base,
    key: transposed.key,
    scale: transposed.scale,
    label: `${transposed.label} (变调 ${semitones > 0 ? `+${semitones}` : semitones})`,
    camelot: transposed.camelot,
    originalLabel: base.label,
  }
})

/**
 * 全局机架电音插件自动同步开关（Auto-Tune 联动）。
 * 绑定全局持久化设置 appSetting['player.songKey.syncPlugin']。
 * 开启后，任何正在播放或切换的歌曲，其调性与实时转调都会自动同步下发给系统 Antares Auto-Key 监听通道。
 */
export const isPluginSyncEnabled = computed({
  get() {
    return Boolean(appSetting['player.songKey.syncPlugin'])
  },
  set(val: boolean) {
    updateSetting({ 'player.songKey.syncPlugin': Boolean(val) })
    if (val && effectiveSongKey.value) {
      void syncKeyToPlugin({ ...effectiveSongKey.value, retuneSpeed: retuneSpeed.value })
    }
  },
})

export const setPluginSyncEnabled = (enabled: boolean) => {
  isPluginSyncEnabled.value = enabled
}

/**
 * 电音深度 / 速度 (Retune Speed, 0~100)。
 * 0 为硬电音（机械瞬吸附，T-Pain / 流行电音标志性效果）；
 * 20 为流行轻电音（默认推荐，清亮且带修音感）；
 * 50~100 为慢速自然修音。
 *
 * 注意：Antares 官方 Auto-Key 协议不包含此参数，因此
 *   - Windows：通过机架通道自动同步给插件。
 *   - macOS：宿主不允许外部程序改插件参数，需在机架里设定一次后固定；
 *            洛雪这边仍然可以调整并记忆该值，用于提示与预设管理。
 */
export const retuneSpeed = computed({
  get() {
    const val = appSetting['player.songKey.retuneSpeed']
    return typeof val === 'number' ? Math.max(0, Math.min(100, Math.round(val))) : 20
  },
  set(val: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(val || 0)))
    updateSetting({ 'player.songKey.retuneSpeed': clamped })
    if (isRetuneSpeedAutomationSupported) {
      void sendMidiRetuneSpeed(clamped)
      if (isPluginSyncEnabled.value) {
        const current = effectiveSongKey.value ?? songKeyInfo.value ?? { key: 'C', scale: 'major' as const, label: '1=C 大调' }
        void syncKeyToPlugin({ ...current, retuneSpeed: clamped })
      }
    }
  },
})

export const setRetuneSpeed = (speed: number) => {
  retuneSpeed.value = speed
}

/**
 * 当前平台是否支持自动同步 RetuneSpeed 到机架插件。
 * Windows 可以；macOS 因宿主安全限制不支持（UI 需如实提示用户）。
 */
export { isRetuneSpeedAutomationSupported }

// 监听当前生效基调，若开启了同步则实时推送到机架插件
watch(effectiveSongKey, (current) => {
  if (isPluginSyncEnabled.value && current) {
    void syncKeyToPlugin({ ...current, retuneSpeed: retuneSpeed.value })
  }
})

let currentRequestId = 0

export const updateCurrentSongKey = async(forceReanalyze = false) => {
  const name = musicInfo.name
  const singer = musicInfo.singer
  if (!name) {
    songKeyInfo.value = null
    isKeyAnalyzing.value = false
    playbackSeconds.value = 0
    return
  }

  const requestId = ++currentRequestId

  // 1. 优先从内存缓存/曲库同步读取：已分析过的、自定义过的、曲库有的，0ms 瞬间显示！
  // 绝不重新分析，绝不闪烁"分析中…"，更绝不重新发起网络下载！
  if (!forceReanalyze) {
    const syncResolved = resolveSongKeySync(name, singer)
    if (syncResolved) {
      songKeyInfo.value = syncResolved
      isKeyAnalyzing.value = false
      playbackSeconds.value = 0
      return
    }
  }

  // 内存未命中（切换到未知/待查新歌时）：立即清空上一首的旧基调，绝不把上一首歌的调挂在当前这首歌上！
  isKeyAnalyzing.value = true
  songKeyInfo.value = null
  playbackSeconds.value = 0

  try {
    if (!forceReanalyze) {
      // 2. 内存未命中的情况（如刚启动），再走一次异步读取存储
      const resolved = await resolveSongKey(name, singer)
      if (requestId !== currentRequestId) return
      if (resolved) {
        songKeyInfo.value = resolved
        isKeyAnalyzing.value = false
        return
      }
    } else {
      // 强制重算：只尊重用户手动设定的基调，缓存与曲库都要重新走一遍
      const userKey = await getSavedUserKey(name, singer)
      if (requestId !== currentRequestId) return
      if (userKey?.source === 'user') {
        songKeyInfo.value = userKey
        isKeyAnalyzing.value = false
        return
      }
    }

    // Step 2: 真实音频分析
    // 曲库与缓存都没命中时，对正在播放的音源做一次 K-S 色度分析。
    // 快速切歌时不值得为此下载解码，先等歌曲稳定播放几秒。
    if (!forceReanalyze) {
      await wait(songKeyTiming.analysisDelayMs)
      if (requestId !== currentRequestId) return
    }

    // 等待音源地址就绪（网络较慢时可能需要 2~4 秒获取真实播放链接，重试等待避免因网络抖动导致"偶尔不显示"）
    let source = getResourceSrc()
    let waitSourceMs = 0
    while (!source && waitSourceMs < 6000) {
      await wait(500)
      if (requestId !== currentRequestId) return
      waitSourceMs += 500
      source = getResourceSrc()
    }

    if (!source) {
      songKeyInfo.value = null
      return
    }

    // 采用渐进式双阶分析：首块解码完毕后 0.5s~1s 内立即把初始调性推到界面，
    // 全曲时间轴在后台继续精细构建并静默接入，绝不让用户在无反馈中等待！
    const analyzed = await analyzeSongAudio(source, (early) => {
      if (requestId === currentRequestId && !songKeyInfo.value) {
        songKeyInfo.value = early
      }
    })
    if (requestId !== currentRequestId) return

    if (!analyzed) {
      // 分析不出来就不显示，宁可空着也不编一个
      songKeyInfo.value = null
      return
    }

    songKeyInfo.value = analyzed
    // 置信度达标才永久写入本地缓存（含全曲时间轴）
    // 保证下次再播这首歌时直接读取，绝不重复下载或重新分析！
    if ((analyzed.confidence ?? 0) >= MIN_CACHEABLE_CONFIDENCE) {
      void saveAnalyzedKey(name, singer, analyzed).catch((err) => {
        console.error('saveAnalyzedKey failed', err)
      })
    }
  } finally {
    if (requestId === currentRequestId) {
      isKeyAnalyzing.value = false
    }
  }
}

export const isNativeWindowActive = ref(false)

const toPlainObject = <T>(data: T): T => {
  if (!data) return data
  try {
    return JSON.parse(JSON.stringify(data)) as T
  } catch {
    return data
  }
}

export const syncToNativeWindow = async(): Promise<void> => {
  if (!isNativeWindowActive.value) return
  const payload = {
    name: musicInfo.name ?? '',
    singer: musicInfo.singer ?? '',
    currentKey: toPlainObject(effectiveSongKey.value),
    songKeyInfo: toPlainObject(songKeyInfo.value),
    playbackSeconds: playbackSeconds.value ?? 0,
    isKeyAnalyzing: isKeyAnalyzing.value ?? false,
    isPluginSyncEnabled: isPluginSyncEnabled.value,
    retuneSpeed: retuneSpeed.value,
    retuneSpeedAuto: isRetuneSpeedAutomationSupported,
    themeCss: (window as any).dom_style?.innerText ?? '',
  }
  const isAlive = await syncNativeSongKeyData(payload)
  isNativeWindowActive.value = Boolean(isAlive)
}

export const openIndependentSongKeyWindow = () => {
  openNativeSongKeyWindow()
  isNativeWindowActive.value = true
  // 多点重试同步，确保窗口渲染完毕后立即接到初始数据
  for (const delay of [50, 200, 500, 1000]) {
    setTimeout(() => {
      void syncToNativeWindow()
    }, delay)
  }
}

export const closeIndependentSongKeyWindow = () => {
  closeNativeSongKeyWindow()
  isNativeWindowActive.value = false
}

// 监听独立窗口回传的保存/重置动作
onSongKeyWindowSaveAction(async(data: any) => {
  if (!data?.name) return
  if (data.mode === 'segments') {
    await saveCurrentSongKeyTimeline(data.segments)
  } else {
    await saveCurrentSongKey(data.key, data.scale)
  }
  void syncToNativeWindow()
})

onSongKeyWindowResetAction(async() => {
  await clearCurrentSongKey()
  void syncToNativeWindow()
})

onSongKeyWindowReanalyzeAction(async() => {
  await updateCurrentSongKey(true)
  void syncToNativeWindow()
})

onSongKeyWindowTogglePluginSync((enabled: boolean) => {
  setPluginSyncEnabled(enabled)
  void syncToNativeWindow()
})

onSongKeyWindowSetRetuneSpeed((speed: number) => {
  setRetuneSpeed(speed)
  void syncToNativeWindow()
})

// 当歌曲、基调、分析状态、播放进度或电音深度变化时，同步推给独立窗口
watch(
  () => [musicInfo.name, musicInfo.singer, effectiveSongKey.value, isKeyAnalyzing.value, playbackSeconds.value, retuneSpeed.value],
  () => {
    if (isNativeWindowActive.value) void syncToNativeWindow()
  },
)

export const saveCurrentSongKey = async(key: NoteName, scale: LX.SongKey.Scale) => {
  const name = musicInfo.name
  const singer = musicInfo.singer
  if (!name) return
  const saved = await setUserKey(name, singer, key, scale)
  songKeyInfo.value = saved
}

/**
 * 保存用户自定义的分段基调。传入空数组等同于放弃分段。
 * 保存后立即生效，且优先级高于曲库与音频分析。
 */
export const saveCurrentSongKeyTimeline = async(segments: LX.SongKey.Segment[]) => {
  const name = musicInfo.name
  const singer = musicInfo.singer
  if (!name) return
  const saved = await setUserKeyTimeline(name, singer, segments)
  if (saved) songKeyInfo.value = saved
}

export const clearCurrentSongKey = async() => {
  const name = musicInfo.name
  const singer = musicInfo.singer
  if (!name) return
  await clearUserKey(name, singer)
  await updateCurrentSongKey(true)
}

// Watch musicInfo change to automatically resolve song key
watch(
  () => [musicInfo.name, musicInfo.singer],
  () => {
    void updateCurrentSongKey()
  },
  { immediate: true },
)

// 跟随播放进度与实时转调。
// 采用「音频事件驱动 + 定时轮询兜底」双轨机制：
// 1. 底层播放器引擎（MPV / AudioElement / Audirvana）抛出 timeupdate 时立即驱动进度更新，
//    即使窗口置于后台、最小化或被机架 DAW 完全遮挡，音频事件流依然全速派发，保证毫秒级实时转调同步！
// 2. 500ms 周期定时器兜底，处理播放器初始化阶段或无事件流的边缘场景。
const updatePlaybackSeconds = () => {
  const seconds = Math.floor(getCurrentTime())
  if (Number.isFinite(seconds) && seconds >= 0 && seconds !== playbackSeconds.value) {
    playbackSeconds.value = seconds
  }
  if (isNativeWindowActive.value) {
    void syncToNativeWindow()
  }
}

try {
  onTimeupdate(updatePlaybackSeconds)
} catch {}

const PROGRESS_POLL_MS = 500
const progressTimer: unknown = setInterval(updatePlaybackSeconds, PROGRESS_POLL_MS)
if (progressTimer && typeof progressTimer === 'object' && 'unref' in progressTimer) {
  (progressTimer as { unref: () => void }).unref()
}
