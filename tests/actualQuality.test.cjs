const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

const source = fs.readFileSync('src/renderer/core/player/actualQuality.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const loadedModule = { exports: {} }
new Function('module', 'exports', 'require', compiled)(loadedModule, loadedModule.exports, require)
const { describeActualQuality } = loadedModule.exports

const flac = (sampleRate, bitsPerSample) => ({
  format: 'flac',
  sampleRate,
  bitsPerSample,
  bytesRead: 1024,
  error: null,
})

const lossy = (format, bitrate) => ({
  format,
  sampleRate: 44100,
  bitrate,
  bytesRead: 1024,
  error: null,
})

const describe = (probe, requested, interval = '04:00') => describeActualQuality({ probe, interval, requested })

test('24bit FLAC keeps the 母带 master tier name instead of being lowered', () => {
  // 平台把 96kHz 与 192kHz 的 24bit 无损都标成母带，界面不应显示成更低的档位。
  for (const sampleRate of [192000, 96000, 88200]) {
    const result = describe(flac(sampleRate, 24), 'master')
    assert.equal(result.quality, 'master')
    assert.equal(result.downgraded, false)
  }
})

test('a 16bit lossless stream is reported as a downgrade for 24bit tiers', () => {
  for (const requested of ['master', 'hires', 'flac24bit']) {
    const result = describe(flac(44100, 16), requested)
    assert.equal(result.quality, 'flac')
    assert.equal(result.downgraded, true)
  }
})

test('a lossy stream for a lossless request keeps the detected bitrate tier', () => {
  assert.deepEqual(describe(lossy('mp3', 320000), 'master'), { quality: '320k', detected: '320k', downgraded: true })
  assert.deepEqual(describe(lossy('mp3', 128000), 'flac'), { quality: '128k', detected: '128k', downgraded: true })
})

test('lossy requests only report a real bitrate downgrade', () => {
  assert.equal(describe(lossy('mp3', 320000), '320k').downgraded, false)
  assert.equal(describe(lossy('mp3', 320000), '320k').quality, '320k')
  const downgraded = describe(lossy('mp3', 128000), '320k')
  assert.equal(downgraded.quality, '128k')
  assert.equal(downgraded.downgraded, true)
  // 无损流比有损请求更好，不应被判成降质。
  assert.equal(describe(flac(44100, 16), '320k').quality, '320k')
  assert.equal(describe(flac(44100, 16), '320k').downgraded, false)
})

test('higher quality than requested keeps the requested tier name', () => {
  assert.equal(describe(flac(96000, 24), 'flac').quality, 'flac')
  assert.equal(describe(flac(96000, 24), 'flac').downgraded, false)
  // 酷狗等平台的 Hi-Res 是 24bit/44.1kHz，不应被标成普通无损。
  assert.equal(describe(flac(44100, 24), 'hires').quality, 'hires')
  assert.equal(describe(flac(44100, 24), 'hires').downgraded, false)
})

test('ambiguous containers and failed probes keep the requested tier', () => {
  const m4a = { format: 'm4a', sampleRate: 48000, bitsPerSample: null, bytesRead: 1024, error: null }
  assert.deepEqual(describe(m4a, 'atmos'), { quality: 'atmos', detected: null, downgraded: false })
  assert.deepEqual(describe({ format: 'flac', sampleRate: null, bytesRead: 0, error: 'HTTP 403' }, 'master'), { quality: 'master', detected: null, downgraded: false })
})

test('bitrate is estimated from size and duration when the header has none', () => {
  const probe = { format: 'mp3', sampleRate: 44100, bitrate: null, contentLength: 8 * 1024 * 1024, bytesRead: 1024, error: null }
  const result = describe(probe, '320k')
  assert.equal(result.detected, '192k')
  assert.equal(result.downgraded, true)
})

test('16bit high sample rate lossless is not reported as Hi-Res', () => {
  const result = describe(flac(96000, 16), 'hires')
  assert.equal(result.detected, 'flac')
  assert.equal(result.quality, 'flac')
  assert.equal(result.downgraded, true)
  // 位深未知时才允许凭采样率推断高解析度。
  const unknownBits = describe(flac(96000, null), 'hires')
  assert.equal(unknownBits.detected, 'hires')
  assert.equal(unknownBits.downgraded, false)
})

test('wav and ape requests still detect a lossy response', () => {
  for (const requested of ['wav', 'ape']) {
    const result = describe(lossy('mp3', 320000), requested)
    assert.equal(result.quality, '320k')
    assert.equal(result.downgraded, true)
  }
})

test('a lossy response without any bitrate evidence keeps the requested tier', () => {
  const probe = { format: 'mp3', sampleRate: 44100, bitrate: null, contentLength: null, bytesRead: 1024, error: null }
  const result = describe(probe, '320k')
  assert.equal(result.detected, null)
  assert.equal(result.downgraded, false)
  assert.equal(result.quality, '320k')
})
