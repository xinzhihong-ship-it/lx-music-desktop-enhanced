import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

/**
 * songKey store 的切歌行为回归测试。
 *
 * 守住的点：切歌后必须立刻丢掉上一首的基调。分析是异步的（要下载+解码），
 * 如果在等待期间继续挂着旧值，就会把上一首的调显示在新歌上。
 */

globalThis.__skState = { name: '', singer: '' }
globalThis.__skSrc = 'http://example.com/a.mp3'
globalThis.__skResolve = async() => null
globalThis.__skAnalyze = async() => null
globalThis.__skSaved = []
globalThis.__skUserKey = null
globalThis.__skAnalyzeDelay = 0

const virtualModules = new Map([
  ['./state', `
    export const musicInfo = globalThis.__skState
  `],
  ['@renderer/store/setting', `
    import { reactive } from '@common/utils/vueTools'
    export const appSetting = reactive({ 'player.soundEffect.pitchShifter.playbackRate': 1, 'player.songKey.syncPlugin': false })
    export const updateSetting = (s) => { Object.assign(appSetting, s) }
  `],
  ['@renderer/plugins/player', `
    export const getResourceSrc = () => globalThis.__skSrc
    export const getCurrentTime = () => globalThis.__skTime ?? 0
    export const onTimeupdate = () => () => {}
  `],
  ['@renderer/utils/ipc', `
    export const openNativeSongKeyWindow = () => {}
    export const closeNativeSongKeyWindow = () => {}
    export const syncNativeSongKeyData = async () => true
    export const onSongKeyWindowSaveAction = () => () => {}
    export const onSongKeyWindowResetAction = () => () => {}
    export const onSongKeyWindowReanalyzeAction = () => () => {}
    export const onSongKeyWindowTogglePluginSync = () => () => {}
    export const onSongKeyWindowSetRetuneSpeed = () => () => {}
  `],
  ['@renderer/utils/musicKey', `
    export const resolveSongKey = (...a) => globalThis.__skResolve(...a)
    export const resolveSongKeySync = (...a) => globalThis.__skResolveSync?.(...a) ?? null
    export const getSavedUserKey = async () => globalThis.__skUserKey
    export const saveAnalyzedKey = async (name, singer, info) => { globalThis.__skSaved.push(info); return info }
    export const setUserKey = async () => ({})
    export const setUserKeyTimeline = async (name, singer, segments) => {
      const label = (s) => (s.scale === 'minor' ? s.key + 'm 小调' : '1=' + s.key + ' 大调')
      // 真实实现会经 normalizeUserTimeline 补齐 label/camelot，这里照做
      const normalized = segments.map((s) => ({ ...s, label: label(s), camelot: '', confidence: 1 }))
      globalThis.__skSavedTimeline = normalized
      const primary = normalized[0]
      return {
        key: primary.key, scale: primary.scale, label: label(primary), camelot: '',
        source: 'user', custom: true, confidence: 1, timeline: normalized,
      }
    }
    export const clearUserKey = async () => {}
    export const analyzeSongAudio = (...a) => globalThis.__skAnalyze(...a)
    export const segmentAt = (timeline, seconds) => {
      if (!timeline || !timeline.length) return null
      let found = timeline[0]
      for (const s of timeline) { if (s.at <= seconds) found = s; else break }
      return found
    }
    export const syncKeyToPlugin = async () => true
    export const sendMidiRetuneSpeed = async () => true
    export const isRetuneSpeedAutomationSupported = process.platform === 'win32'
    export const getAutoKeyCodes = () => ({ keyClass: 0, keyType: 0 })
    export const transposeKey = (key, scale) => ({ key, scale, label: key, camelot: '' })
    export const getSemitonesFromPlaybackRate = () => 0
    export const MIN_CACHEABLE_CONFIDENCE = 0.5
  `],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const virtual = virtualModules.get(specifier)
    if (virtual != null) {
      return { url: `data:text/javascript,${encodeURIComponent(virtual)}`, shortCircuit: true }
    }
    if (specifier === '@common/utils/vueTools') {
      return { url: new URL('../src/common/utils/vueTools.ts', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const {
  songKeyInfo,
  isKeyAnalyzing,
  songKeyTiming,
  playbackSeconds,
  effectiveSongKey,
  updateCurrentSongKey,
  saveCurrentSongKeyTimeline,
} = await import('../src/renderer/store/player/songKey.ts')

// 测试里不需要等真实的 4 秒稳定期
songKeyTiming.analysisDelayMs = 0

const flush = () => new Promise((resolve) => setImmediate(resolve))
/** 让 updateCurrentSongKey 跨过 resolveSongKey 与 delay 两个 await 点 */
const settle = async() => {
  await flush()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await flush()
}

const gMajor = { key: 'G', scale: 'major', label: '1=G 大调', camelot: '9B', source: 'analysis', confidence: 0.8 }
const eMajor = { key: 'E', scale: 'major', label: '1=E 大调', camelot: '12B', source: 'database', confidence: 0.98 }

const setSong = (name, singer) => {
  globalThis.__skState.name = name
  globalThis.__skState.singer = singer
}

test('切歌后立即清空上一首的基调，不会把旧值挂到新歌上', async() => {
  globalThis.__skResolve = async() => eMajor
  setSong('第一首', '歌手甲')
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value.label, '1=E 大调')

  // 切到一首需要分析的新歌：分析还没跑完
  globalThis.__skResolve = async() => null
  let releaseAnalysis
  globalThis.__skAnalyze = () => new Promise((resolve) => { releaseAnalysis = resolve })
  setSong('第二首', '歌手乙')

  const pending = updateCurrentSongKey()
  // 关键断言：此刻不能还显示上一首的 1=E 大调
  assert.equal(songKeyInfo.value, null, '切歌瞬间必须清空旧基调')
  assert.equal(isKeyAnalyzing.value, true, '应当处于分析中状态')

  await settle()
  assert.equal(typeof releaseAnalysis, 'function', '应当已经进入音频分析阶段')
  releaseAnalysis(gMajor)
  await pending
  assert.equal(songKeyInfo.value.label, '1=G 大调')
  assert.equal(isKeyAnalyzing.value, false)
})

test('命中曲库/缓存时立刻回填，不需要分析', async() => {
  globalThis.__skResolveSync = () => eMajor
  globalThis.__skResolve = async() => eMajor
  let analyzed = false
  globalThis.__skAnalyze = async() => { analyzed = true; return null }
  setSong('曲库里的歌', '某歌手')
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value.label, '1=E 大调')
  assert.equal(analyzed, false, '命中后不应触发音频分析')
  assert.equal(isKeyAnalyzing.value, false, '已命中的歌绝不进入分析状态')
  globalThis.__skResolveSync = null
})

test('分析失败时不显示任何基调（而不是编一个）', async() => {
  globalThis.__skResolve = async() => null
  globalThis.__skAnalyze = async() => null
  setSong('分析不出来的歌', '某歌手')
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value, null)
  assert.equal(isKeyAnalyzing.value, false)
})

test('取不到音源时也不显示基调', async() => {
  globalThis.__skResolve = async() => null
  globalThis.__skSrc = ''
  setSong('没有音源的歌', '某歌手')
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value, null)
  globalThis.__skSrc = 'http://example.com/a.mp3'
})

test('快速连续切歌：先发起的那次分析不会覆盖后发起的结果', async() => {
  globalThis.__skResolve = async() => null
  const resolvers = []
  globalThis.__skAnalyze = () => new Promise((resolve) => { resolvers.push(resolve) })

  setSong('歌A', '歌手')
  const first = updateCurrentSongKey()
  await settle()
  assert.equal(resolvers.length, 1, '歌A 应已进入分析')

  setSong('歌B', '歌手')
  const second = updateCurrentSongKey()
  await settle()
  assert.equal(resolvers.length, 2, '歌B 也应进入分析')

  // 后发起的 B 先返回
  resolvers[1]({ ...gMajor, source: 'analysis', label: '1=G 大调' })
  await second
  assert.equal(songKeyInfo.value.label, '1=G 大调')

  // 先发起的 A 姗姗来迟，必须被丢弃
  resolvers[0]({ ...eMajor, source: 'analysis', label: '1=E 大调' })
  await first
  assert.equal(songKeyInfo.value.label, '1=G 大调', '过期的分析结果不能覆盖当前歌曲')
  assert.equal(isKeyAnalyzing.value, false)
})

test('置信度达标才写缓存', async() => {
  globalThis.__skSaved = []
  globalThis.__skResolve = async() => null
  globalThis.__skAnalyze = async() => ({ ...gMajor, confidence: 0.9 })
  setSong('高置信度', '歌手')
  await updateCurrentSongKey()
  assert.equal(globalThis.__skSaved.length, 1)

  globalThis.__skSaved = []
  globalThis.__skAnalyze = async() => ({ ...gMajor, confidence: 0.2 })
  setSong('低置信度', '歌手')
  await updateCurrentSongKey()
  assert.equal(globalThis.__skSaved.length, 0, '低置信度不应写入缓存')
  // 但结果仍然展示，只是不固化
  assert.equal(songKeyInfo.value.label, '1=G 大调')
})

// ── 时间轴跟播 ────────────────────────────────────────────────────

const modulatingTimeline = [
  { at: 0, key: 'G', scale: 'major', label: '1=G 大调', camelot: '9B', confidence: 0.8 },
  { at: 45, key: 'A', scale: 'major', label: '1=A 大调', camelot: '11B', confidence: 0.75 },
]

test('有时间轴时，显示的调随播放位置切换', async() => {
  globalThis.__skResolve = async() => null
  globalThis.__skAnalyze = async() => ({
    key: 'G',
    scale: 'major',
    label: '1=G 大调',
    camelot: '9B',
    source: 'analysis',
    confidence: 0.8,
    timeline: modulatingTimeline,
  })
  setSong('转调的歌', '某歌手')
  await updateCurrentSongKey()

  playbackSeconds.value = 0
  assert.equal(effectiveSongKey.value.label, '1=G 大调')

  playbackSeconds.value = 30
  assert.equal(effectiveSongKey.value.label, '1=G 大调', '副歌之前仍是主歌的调')

  playbackSeconds.value = 46
  assert.equal(effectiveSongKey.value.label, '1=A 大调', '过了换调点应切换')

  playbackSeconds.value = 200
  assert.equal(effectiveSongKey.value.label, '1=A 大调')
})

test('没有时间轴的曲库结果整首不变', async() => {
  globalThis.__skResolve = async() => ({ ...eMajor })
  setSong('曲库的歌', '某歌手')
  playbackSeconds.value = 0
  await updateCurrentSongKey()
  assert.equal(effectiveSongKey.value.label, '1=E 大调')
  playbackSeconds.value = 300
  assert.equal(effectiveSongKey.value.label, '1=E 大调', '单值结果不受播放位置影响')
})

test('切歌时播放位置归零，不会沿用上一首的进度', async() => {
  globalThis.__skResolve = async() => null
  globalThis.__skAnalyze = async() => ({
    key: 'G',
    scale: 'major',
    label: '1=G 大调',
    camelot: '9B',
    source: 'analysis',
    confidence: 0.8,
    timeline: modulatingTimeline,
  })
  setSong('第一首转调歌', '某歌手')
  await updateCurrentSongKey()
  playbackSeconds.value = 120
  assert.equal(effectiveSongKey.value.label, '1=A 大调')

  globalThis.__skResolve = async() => ({ ...eMajor })
  setSong('第二首', '某歌手')
  await updateCurrentSongKey()
  assert.equal(playbackSeconds.value, 0, '切歌后进度应归零')
})

test('用户自定义分段基调保存后立刻生效，并随时间轴跟播', async() => {
  globalThis.__skResolve = async() => ({ ...eMajor })
  setSong('我要自己定分段的歌', '某歌手')
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value.source, 'database', '先走曲库')

  await saveCurrentSongKeyTimeline([
    { at: 0, key: 'E', scale: 'major' },
    { at: 96, key: 'F', scale: 'major' },
  ])
  assert.equal(songKeyInfo.value.source, 'user', '保存后应切到用户设定')
  assert.equal(globalThis.__skSavedTimeline.length, 2)

  playbackSeconds.value = 10
  assert.equal(effectiveSongKey.value.label, '1=E 大调')
  playbackSeconds.value = 100
  assert.equal(effectiveSongKey.value.label, '1=F 大调', '过了自定义换调点应切换')
})

test('没有时间轴的歌，播放进度也要跟着走（弹窗的"当前位置"依赖它）', async() => {
  // 曲库命中 => songKeyInfo 没有 timeline
  globalThis.__skResolve = async() => ({ ...eMajor })
  setSong('曲库里的歌', '某歌手')
  globalThis.__skTime = 0
  await updateCurrentSongKey()
  assert.equal(songKeyInfo.value.timeline, undefined, '曲库结果不应带时间轴')

  // 让轮询跑起来
  globalThis.__skTime = 42.7
  await new Promise((resolve) => setTimeout(resolve, 700))

  assert.equal(playbackSeconds.value, 42, '即使没有时间轴，播放进度也必须更新（取整到秒）')
})

test('isPluginSyncEnabled 是全局设置，开启后对所有歌曲持久生效', async() => {
  const { isPluginSyncEnabled, setPluginSyncEnabled } = await import('../src/renderer/store/player/songKey.ts')
  assert.equal(isPluginSyncEnabled.value, false, '默认未启用')
  setPluginSyncEnabled(true)
  assert.equal(isPluginSyncEnabled.value, true, '开启后响应式更新')
})

test('retuneSpeed 电音深度支持 0~100 调节并持久化', async() => {
  const { retuneSpeed, setRetuneSpeed } = await import('../src/renderer/store/player/songKey.ts')
  assert.equal(typeof retuneSpeed.value, 'number')
  setRetuneSpeed(0)
  assert.equal(retuneSpeed.value, 0, '可设为 0 (硬电音)')
  setRetuneSpeed(20)
  assert.equal(retuneSpeed.value, 20, '可设为 20 (流行默认)')
  setRetuneSpeed(150)
  assert.equal(retuneSpeed.value, 100, '超出 100 自动钳位到 100')
  setRetuneSpeed(-10)
  assert.equal(retuneSpeed.value, 0, '低于 0 自动钳位到 0')
})
