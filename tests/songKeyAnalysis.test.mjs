import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

/**
 * 基调音频分析链路的回归测试。
 *
 * 重点守住两件事：
 *  1. 主进程取音频时的分片/截断行为正确（不要把整轨无损都拉下来）
 *  2. 分析不出来时返回 null —— 绝不再像旧实现那样用哈希编一个调出来
 */

// ── 虚拟渲染进程 ipc 模块 ─────────────────────────────────────────
globalThis.__skQueue = []
globalThis.__skCalls = []
globalThis.__skStore = {}

const virtualModules = new Map([
  ['@renderer/utils/ipc', `
    export const fetchSongKeyAudio = async (source, maxBytes) => {
      globalThis.__skCalls.push({ source, maxBytes })
      return globalThis.__skQueue.shift() ?? null
    }
    export const getUserSongKeys = async () => globalThis.__skStore
    export const saveUserSongKeys = (keys) => { globalThis.__skStore = keys }
  `],
  ['@common/rendererIpc', `
    export const rendererInvoke = async () => true
  `],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const virtual = virtualModules.get(specifier)
    if (virtual != null) {
      return { url: `data:text/javascript,${encodeURIComponent(virtual)}`, shortCircuit: true }
    }
    if (specifier === '@common/ipcNames') {
      return { url: new URL('../src/common/ipcNames.ts', import.meta.url).href, shortCircuit: true }
    }
    if (specifier === './ksAlgorithm') {
      return { url: new URL('../src/renderer/utils/musicKey/ksAlgorithm.ts', import.meta.url).href, shortCircuit: true }
    }
    if (specifier === './database') {
      return { url: new URL('../src/renderer/utils/musicKey/database.ts', import.meta.url).href, shortCircuit: true }
    }
    if (specifier === './audioAnalysis') {
      return { url: new URL('../src/renderer/utils/musicKey/audioAnalysis.ts', import.meta.url).href, shortCircuit: true }
    }
    if (specifier === './pluginSync') {
      return { url: new URL('../src/renderer/utils/musicKey/pluginSync.ts', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

// ── 假的 AudioContext / AudioBuffer ───────────────────────────────
class FakeAudioContext {
  async decodeAudioData(buffer) {
    const handler = globalThis.__skDecodeHandler
    if (!handler) throw new Error('decode failed')
    const result = handler(buffer)
    if (!result) throw new Error('decode failed')
    return result
  }
}
globalThis.window = { AudioContext: FakeAudioContext }

/** 直通式 OfflineAudioContext：把源 buffer 原样交回给分析阶段 */
class FakeOfflineAudioContext {
  constructor(_channels, length, sampleRate) {
    this.length = length
    this.sampleRate = sampleRate
    this.destination = {}
    this._buffer = null
  }

  createBufferSource() {
    const self = this
    return {
      get buffer() { return self._buffer },
      set buffer(value) { self._buffer = value },
      connect() {},
      start() {},
    }
  }

  async startRendering() {
    return this._buffer
  }
}
globalThis.window.OfflineAudioContext = FakeOfflineAudioContext

const makeAudioBuffer = (samples, sampleRate = 22050, channels = 1) => {
  const data = Array.from({ length: channels }, () => samples)
  return {
    sampleRate,
    length: samples.length,
    numberOfChannels: channels,
    duration: samples.length / sampleRate,
    getChannelData: (index) => data[index],
  }
}

/** 生成 G 大调和弦，用于验证分析结果落在预期调性上 */
const gMajorSamples = (sampleRate = 22050, seconds = 40) => {
  const numSamples = Math.floor(sampleRate * seconds)
  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    samples[i] =
      0.5 * Math.sin(2 * Math.PI * 196.0 * t) +
      0.3 * Math.sin(2 * Math.PI * 246.94 * t) +
      0.3 * Math.sin(2 * Math.PI * 293.66 * t)
  }
  return samples
}

const {
  fetchSongKeyAudio,
} = await import('../src/main/utils/songKeyAudio.ts')

const {
  analyzeSongAudio,
  segmentAt,
} = await import('../src/renderer/utils/musicKey/audioAnalysis.ts')

const {
  resolveSongKey,
  saveAnalyzedKey,
  setUserKey,
  clearUserKey,
  setUserKeyTimeline,
  normalizeUserTimeline,
  getAutoKeyCodes,
} = await import('../src/renderer/utils/musicKey/index.ts')

const {
  writeAutoKeyHandoff,
} = await import('../src/main/utils/autoKeyHandoff.ts')

// ── 主进程取音频 ──────────────────────────────────────────────────

test('本地文件：小于上限时整段返回，truncated=false', async() => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-'))
  const file = path.join(dir, 'a.bin')
  const payload = Buffer.from('0123456789')
  await fs.writeFile(file, payload)

  const chunk = await fetchSongKeyAudio(file, 1024)
  assert.ok(chunk)
  assert.equal(Buffer.from(chunk.bytes).toString(), '0123456789')
  assert.equal(chunk.totalBytes, 10)
  assert.equal(chunk.truncated, false)
})

test('本地文件：超过上限时只取开头，truncated=true', async() => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-'))
  const file = path.join(dir, 'b.bin')
  await fs.writeFile(file, Buffer.from('ABCDEFGHIJ'))

  const chunk = await fetchSongKeyAudio(file, 4)
  assert.ok(chunk)
  assert.equal(Buffer.from(chunk.bytes).toString(), 'ABCD')
  assert.equal(chunk.totalBytes, 10)
  assert.equal(chunk.truncated, true)
})

test('本地文件不存在时返回 null 而不是空块', async() => {
  const chunk = await fetchSongKeyAudio('/definitely/not/here.mp3', 1024)
  assert.equal(chunk, null)
})

test('maxBytes 非法时不发请求', async() => {
  assert.equal(await fetchSongKeyAudio('http://127.0.0.1:1/x', 0), null)
  assert.equal(await fetchSongKeyAudio('http://127.0.0.1:1/x', -5), null)
})

const withServer = async(handler, run) => {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('HTTP：服务端支持 Range 时按分片取，并正确报告总大小', async() => {
  const body = Buffer.alloc(1000, 7)
  let sawRange = null
  await withServer((req, res) => {
    sawRange = req.headers.range
    const m = /bytes=0-(\d+)/.exec(req.headers.range ?? '')
    const end = Math.min(Number(m?.[1] ?? 0), body.length - 1)
    res.writeHead(206, {
      'content-type': 'audio/mpeg',
      'content-range': `bytes 0-${end}/${body.length}`,
      'content-length': end + 1,
    })
    res.end(body.subarray(0, end + 1))
  }, async(base) => {
    const chunk = await fetchSongKeyAudio(`${base}/song.mp3`, 200)
    assert.equal(sawRange, 'bytes=0-199')
    assert.ok(chunk)
    assert.equal(chunk.bytes.length, 200)
    assert.equal(chunk.totalBytes, 1000)
    assert.equal(chunk.truncated, true)
  })
})

test('HTTP：服务端不支持 Range（200 全量）时仍能取到数据', async() => {
  const body = Buffer.alloc(300, 3)
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': body.length })
    res.end(body)
  }, async(base) => {
    const chunk = await fetchSongKeyAudio(`${base}/song.mp3`, 4096)
    assert.ok(chunk)
    assert.equal(chunk.bytes.length, 300)
    assert.equal(chunk.totalBytes, 300)
    assert.equal(chunk.truncated, false)
  })
})

test('HTTP：404 时返回 null', async() => {
  await withServer((_req, res) => {
    res.writeHead(404)
    res.end('nope')
  }, async(base) => {
    assert.equal(await fetchSongKeyAudio(`${base}/missing.mp3`, 1024), null)
  })
})

// ── 渲染进程分析 ──────────────────────────────────────────────────

const primeFetch = (...chunks) => {
  globalThis.__skQueue = chunks.slice()
  globalThis.__skCalls = []
}

test('解码成功时返回真实分析结果，且 source 为 analysis', async() => {
  primeFetch({ bytes: new Uint8Array([1, 2, 3]), totalBytes: 3, truncated: false })
  globalThis.__skDecodeHandler = () => makeAudioBuffer(gMajorSamples())

  const info = await analyzeSongAudio('http://example.com/a.mp3')
  assert.ok(info)
  assert.equal(info.key, 'G')
  assert.equal(info.scale, 'major')
  assert.equal(info.label, '1=G 大调')
  assert.equal(info.source, 'analysis')
  assert.ok(info.confidence > 0.5)
})

test('首块解码失败但完整文件在兜底范围内时，自动取全量重试', async() => {
  primeFetch(
    { bytes: new Uint8Array(1024), totalBytes: 2 * 1024 * 1024, truncated: true },
    { bytes: new Uint8Array(2 * 1024 * 1024), totalBytes: 2 * 1024 * 1024, truncated: false },
  )
  let attempt = 0
  globalThis.__skDecodeHandler = () => {
    attempt += 1
    // 第一次（截断）解码失败，第二次（完整）成功
    return attempt === 1 ? null : makeAudioBuffer(gMajorSamples())
  }

  const info = await analyzeSongAudio('http://example.com/big.flac')
  assert.ok(info)
  assert.equal(info.label, '1=G 大调')
  assert.equal(globalThis.__skCalls.length, 2, '应当发起第二次全量请求')
  assert.equal(globalThis.__skCalls[1].maxBytes, 2 * 1024 * 1024)
})

test('完整文件超出兜底上限时放弃，不编造结果', async() => {
  primeFetch({ bytes: new Uint8Array(1024), totalBytes: 200 * 1024 * 1024, truncated: true })
  globalThis.__skDecodeHandler = () => null

  const info = await analyzeSongAudio('http://example.com/huge.flac')
  assert.equal(info, null)
  assert.equal(globalThis.__skCalls.length, 1, '不应为一个超大文件发起全量请求')
})

test('完全取不到音频数据时返回 null', async() => {
  primeFetch(null)
  globalThis.__skDecodeHandler = null
  assert.equal(await analyzeSongAudio('http://example.com/x.mp3'), null)
})

test('空音源不发请求', async() => {
  primeFetch()
  assert.equal(await analyzeSongAudio(''), null)
  assert.equal(globalThis.__skCalls.length, 0)
})

// ── 缓存与优先级 ──────────────────────────────────────────────────

test('未知歌曲不再被编出一个调：resolve 返回 null', async() => {
  globalThis.__skStore = {}
  const info = await resolveSongKey('一首完全不存在的歌', '不存在的歌手')
  assert.equal(info, null)
})

test('分析结果可以写入缓存并被读回（包含全曲时间轴）', async() => {
  globalThis.__skStore = {}
  const mockTimeline = [
    { at: 0, key: 'G', scale: 'major', label: '1=G 大调', camelot: '9B', confidence: 0.8 },
    { at: 60, key: 'A', scale: 'major', label: '1=A 大调', camelot: '11B', confidence: 0.75 },
  ]
  await saveAnalyzedKey('缓存测试歌', '缓存测试歌手', {
    key: 'G',
    scale: 'major',
    label: '1=G 大调',
    camelot: '9B',
    source: 'analysis',
    confidence: 0.8,
    timeline: mockTimeline,
  })
  const info = await resolveSongKey('缓存测试歌', '缓存测试歌手')
  assert.ok(info)
  assert.equal(info.label, '1=G 大调')
  assert.equal(info.source, 'analysis')
  assert.ok(Array.isArray(info.timeline), '缓存中必须保留时间轴')
  assert.equal(info.timeline.length, 2)
  assert.equal(info.timeline[1].label, '1=A 大调')
})

test('用户手动设定的基调不会被分析结果覆盖', async() => {
  globalThis.__skStore = {}
  await setUserKey('优先级测试', '某歌手', 'D', 'minor')
  const kept = await saveAnalyzedKey('优先级测试', '某歌手', {
    key: 'G', scale: 'major', label: '1=G 大调', camelot: '9B', source: 'analysis',
  })
  assert.equal(kept.source, 'user')
  assert.equal(kept.label, 'Dm 小调')

  const info = await resolveSongKey('优先级测试', '某歌手')
  assert.equal(info.source, 'user')
  assert.equal(info.label, 'Dm 小调')
})

test('内置曲库优先于之前的分析缓存', async() => {
  globalThis.__skStore = {}
  // 先塞一个错误的分析缓存
  await saveAnalyzedKey('晴天', '周杰伦', {
    key: 'C', scale: 'minor', label: 'Cm 小调', camelot: '5A', source: 'analysis',
  })
  const info = await resolveSongKey('晴天', '周杰伦')
  assert.equal(info.source, 'database', '曲库应压过分析缓存')
  assert.equal(info.label, '1=G 大调')
})

test('用户设定存在期间不写入分析缓存，清除后重新走分析', async() => {
  globalThis.__skStore = {}
  await setUserKey('清除测试', '某歌手', 'F', 'major')
  // 用户已手动设定时，分析结果不应抢占这个位置
  const kept = await saveAnalyzedKey('清除测试', '某歌手', {
    key: 'A', scale: 'minor', label: 'Am 小调', camelot: '8A', source: 'analysis',
  })
  assert.equal(kept.source, 'user')

  await clearUserKey('清除测试', '某歌手')
  // 清除后没有历史分析缓存，返回 null 交给上层重新分析（而不是编一个）
  assert.equal(await resolveSongKey('清除测试', '某歌手'), null)
})

// ── 时间轴：转调歌曲 ──────────────────────────────────────────────

/** 合成一首会转调的歌：前 half 秒一个调，之后换另一个调 */
const modulatingSong = (sampleRate, first, second, halfSeconds, totalSeconds) => {
  const total = Math.floor(sampleRate * totalSeconds)
  const half = Math.floor(sampleRate * halfSeconds)
  const samples = new Float32Array(total)
  const tone = (freqs, t) => freqs.reduce((acc, f, i) => acc + (i === 0 ? 0.5 : 0.3) * Math.sin(2 * Math.PI * f * t), 0)
  // G 大调：G3 B3 D4；D 大调：D4 F#4 A4
  const gMajor = [196.0, 246.94, 293.66]
  const dMajor = [293.66, 369.99, 440.0]
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate
    samples[i] = i < half ? tone(gMajor, t) : tone(dMajor, t)
  }
  return samples
}

test('转调歌曲能分析出时间轴，主歌与副歌分别是不同的调', async() => {
  primeFetch({ bytes: new Uint8Array(64), totalBytes: 64, truncated: false })
  globalThis.__skDecodeHandler = () => makeAudioBuffer(modulatingSong(11025, null, null, 30, 60), 11025)

  const info = await analyzeSongAudio('http://example.com/modulate.mp3')
  assert.ok(info)
  assert.ok(Array.isArray(info.timeline), '应当产生时间轴')
  assert.ok(info.timeline.length >= 2, `转调歌曲至少应有 2 段，实际 ${info.timeline.length}`)

  const first = info.timeline[0]
  const last = info.timeline[info.timeline.length - 1]
  assert.equal(first.at, 0, '第一段必须从 0 秒开始')
  assert.equal(first.label, '1=G 大调')
  assert.equal(last.label, '1=D 大调')
  // 合成素材的边界是突变的；真实歌曲转调常有过渡，留一个跳长的余量
  assert.ok(Math.abs(last.at - 30) <= 3, `换调点 ${last.at}s 应落在 30s 附近`)
})

test('segmentAt 按播放位置取对应段落', () => {
  const timeline = [
    { at: 0, key: 'G', scale: 'major', label: '1=G 大调', camelot: '9B', confidence: 0.8 },
    { at: 45, key: 'A', scale: 'major', label: '1=A 大调', camelot: '11B', confidence: 0.7 },
  ]
  assert.equal(segmentAt(timeline, 0).label, '1=G 大调')
  assert.equal(segmentAt(timeline, 44.9).label, '1=G 大调')
  assert.equal(segmentAt(timeline, 45).label, '1=A 大调')
  assert.equal(segmentAt(timeline, 300).label, '1=A 大调', '超出末尾取最后一段')
  assert.equal(segmentAt(undefined, 10), null)
  assert.equal(segmentAt([], 10), null)
})

test('没有时间轴的曲库结果整首不变', () => {
  const libraryKey = { key: 'E', scale: 'major', label: '1=E 大调', camelot: '12B', source: 'database' }
  assert.equal(segmentAt(libraryKey.timeline, 100), null)
})

// ── 用户自定义分段基调 ────────────────────────────────────────────

test('normalizeUserTimeline 会排序、去重、补齐标签', () => {
  const result = normalizeUserTimeline([
    { at: 96, key: 'F', scale: 'major' },
    { at: 0, key: 'E', scale: 'major' },
    { at: 96, key: 'G', scale: 'minor' }, // 同一秒，后者应覆盖前者
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].at, 0)
  assert.equal(result[0].label, '1=E 大调')
  assert.equal(result[1].at, 96)
  assert.equal(result[1].label, 'Gm 小调', '同一秒应保留后写入的那条')
  assert.equal(result[1].camelot, '6A', '应当补齐 Camelot')
})

test('normalizeUserTimeline 会自动合并相邻同调性的重复分段', () => {
  const result = normalizeUserTimeline([
    { at: 0, key: 'C', scale: 'minor' },
    { at: 64, key: 'C', scale: 'minor' }, // 1:04 与 1:30 同调，自动合并
    { at: 90, key: 'C', scale: 'minor' },
    { at: 120, key: 'D', scale: 'major' },
  ])
  assert.equal(result.length, 2, '前三段同为 Cm 应合并为一段')
  assert.equal(result[0].at, 0)
  assert.equal(result[0].label, 'Cm 小调')
  assert.equal(result[1].at, 120)
  assert.equal(result[1].label, '1=D 大调')
})

test('normalizeUserTimeline 会把第一段拉回 0 秒并丢弃非法项', () => {
  const result = normalizeUserTimeline([
    { at: 50, key: 'G', scale: 'major' },
    { at: -10, key: 'C', scale: 'major' }, // 负数丢弃
    { at: 80, key: '', scale: 'major' }, // 无音名丢弃
    { at: Number.NaN, key: 'D', scale: 'major' },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].at, 0, '第一段必须从 0 开始')
  assert.equal(result[0].key, 'G')
})

test('normalizeUserTimeline 接受空输入', () => {
  assert.deepEqual(normalizeUserTimeline([]), [])
  assert.deepEqual(normalizeUserTimeline(undefined), [])
})

test('用户自定义的分段基调优先级最高，压过曲库', async() => {
  globalThis.__skStore = {}
  await setUserKeyTimeline('晴天', '周杰伦', [
    { at: 0, key: 'E', scale: 'major' },
    { at: 120, key: 'F', scale: 'major' },
  ])
  const info = await resolveSongKey('晴天', '周杰伦')
  assert.equal(info.source, 'user', '用户分段应压过经典谱库')
  assert.equal(info.timeline.length, 2)
  assert.equal(info.timeline[0].label, '1=E 大调')
  assert.equal(info.timeline[1].at, 120)
})

test('用户分段基调不会被后来的音频分析覆盖', async() => {
  globalThis.__skStore = {}
  await setUserKeyTimeline('会被覆盖吗', '某歌手', [{ at: 0, key: 'A', scale: 'minor' }])
  const saved = await saveAnalyzedKey('会被覆盖吗', '某歌手', {
    key: 'C', scale: 'major', label: '1=C 大调', camelot: '8B', source: 'analysis',
  })
  assert.equal(saved.source, 'user')
  const info = await resolveSongKey('会被覆盖吗', '某歌手')
  assert.equal(info.label, 'Am 小调')
})

test('空的分段列表不会写入存储', async() => {
  globalThis.__skStore = {}
  assert.equal(await setUserKeyTimeline('空分段', '某歌手', []), null)
  assert.equal(await resolveSongKey('空分段', '某歌手'), null)
})

// ── Antares Auto-Key 机架电音插件同步标准协议 ────────────────────

test('getAutoKeyCodes 音名与等音自动归一化到 Antares 标准', () => {
  // C 大调 -> KeyClass:0, KeyType:0
  assert.deepEqual(getAutoKeyCodes('C', 'major'), { keyClass: 0, keyType: 0 })
  // C# 大调 与 Db 大调 等音归一 -> KeyClass:1, KeyType:0
  assert.deepEqual(getAutoKeyCodes('C#', 'major'), { keyClass: 1, keyType: 0 })
  assert.deepEqual(getAutoKeyCodes('Db', 'major'), { keyClass: 1, keyType: 0 })
  // A 小调 -> KeyClass:9, KeyType:1
  assert.deepEqual(getAutoKeyCodes('A', 'minor'), { keyClass: 9, keyType: 1 })
  // Bb 小调 与 A# 小调 等音归一 -> KeyClass:10, KeyType:1
  assert.deepEqual(getAutoKeyCodes('Bb', 'minor'), { keyClass: 10, keyType: 1 })
  assert.deepEqual(getAutoKeyCodes('A#', 'minor'), { keyClass: 10, keyType: 1 })
})

test('writeAutoKeyHandoff 只写官方协议承认的两个字段', async() => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')

  const payload = {
    key: 'A#',
    scale: 'minor',
    keyClass: 10,
    keyType: 1,
    retuneSpeed: 35,
    label: 'A#m 小调',
  }
  const ok = writeAutoKeyHandoff(payload)
  assert.ok(ok, '应当成功写入协议目录')

  // 官方 macOS 硬编码路径必须被写入，且内容只含 KeyClass / KeyType。
  const handoff = path.join(os.homedir(), 'Music', 'Audio Music Apps', 'Temp', 'Auto-Key.handoff')
  assert.ok(fs.existsSync(handoff), '官方监听路径应存在')
  const xml = fs.readFileSync(handoff, 'utf8')
  assert.match(xml, /name="KeyClass" val="10"/, 'KeyClass 必须正确')
  assert.match(xml, /name="KeyType" val="1"/, 'KeyType 必须正确')

  // 逆向确认：这两个名字不在协议里，写进去 Auto-Tune 也不会读，必须不能出现。
  assert.ok(!xml.includes('RetuneSpeed'), 'RetuneSpeed 不属于协议，不应写入')
  assert.ok(!xml.includes('ReferencePitch'), 'ReferencePitch 不属于协议，不应写入')
})

test('RetuneSpeed 自动同步能力按平台区分（Windows 支持 / macOS 不支持）', async() => {
  const mod = await import('../src/renderer/utils/musicKey/pluginSync.ts')
  const expected = process.platform === 'win32'
  assert.equal(
    mod.isRetuneSpeedAutomationSupported,
    expected,
    `当前平台 ${process.platform} 的能力标记应为 ${expected}`,
  )
})
