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

test('24bit lossless is always hires, and satisfies 母带 without a rate check', () => {
  for (const sampleRate of [44100, 48000, 88200, 96000, 192000]) {
    const result = describe(flac(sampleRate, 24), 'master')
    assert.equal(result.detected, 'hires')
    assert.equal(result.quality, 'master')
    assert.equal(result.downgraded, false)
  }
  // 请求 hires / flac24bit（旧键）同样沿用请求档位。
  assert.equal(describe(flac(44100, 24), 'hires').quality, 'hires')
  assert.equal(describe(flac(44100, 24), 'flac24bit').quality, 'flac24bit')
  assert.equal(describe(flac(44100, 24), 'flac').quality, 'flac')
})

test('a 16bit lossless stream is a downgrade for 24bit tiers', () => {
  for (const requested of ['master', 'hires', 'flac24bit']) {
    const result = describe(flac(96000, 16), requested)
    assert.equal(result.detected, 'flac')
    assert.equal(result.quality, 'flac')
    assert.equal(result.downgraded, true)
  }
  const plain = describe(flac(44100, 16), 'flac')
  assert.equal(plain.quality, 'flac')
  assert.equal(plain.downgraded, false)
})

test('lossy responses for lossless requests report the detected bitrate tier', () => {
  assert.deepEqual(describe(lossy('mp3', 320000), 'master'), { quality: '320k', detected: '320k', downgraded: true })
  assert.deepEqual(describe(lossy('aac', 128000), 'flac'), { quality: '128k', detected: '128k', downgraded: true })
  // 中间码率没有对应档位，按最低有损档提示。
  assert.deepEqual(describe(lossy('mp3', 192000), 'master'), { quality: '128k', detected: null, downgraded: true })
})

test('lossy requests only report a real lower tier', () => {
  const same = describe(lossy('mp3', 320000), '320k')
  assert.equal(same.quality, '320k')
  assert.equal(same.downgraded, false)

  const lower = describe(lossy('mp3', 128000), '320k')
  assert.equal(lower.quality, '128k')
  assert.equal(lower.downgraded, true)

  // 180k–280k 属于中间区间，不判定降质，沿用请求档位。
  for (const quality of ['128k', '320k', '192k']) {
    const middle = describe(lossy('mp3', 192000), quality)
    assert.equal(middle.quality, quality)
    assert.equal(middle.downgraded, false)
  }

  const lossless = describe(flac(44100, 16), '320k')
  assert.equal(lossless.quality, '320k')
  assert.equal(lossless.downgraded, false)
})

test('the verdict never emits the legacy flac24bit or 192k keys', () => {
  const probes = [flac(44100, 16), flac(44100, 24), flac(96000, 24), lossy('mp3', 128000), lossy('mp3', 192000), lossy('mp3', 320000)]
  const requested = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k', 'ape', 'wav']
  for (const probe of probes) {
    for (const quality of requested) {
      const result = describe(probe, quality)
      if (result.downgraded) assert.ok(['128k', '320k', 'flac'].includes(result.quality), `${result.quality} should be a downgrade tier`)
      assert.notEqual(result.detected, 'flac24bit')
      assert.notEqual(result.detected, '192k')
    }
  }
})

test('ambiguous containers and failed probes keep the requested tier', () => {
  const m4a = { format: 'm4a', sampleRate: 48000, bitsPerSample: null, bytesRead: 1024, error: null }
  assert.deepEqual(describe(m4a, 'atmos'), { quality: 'atmos', detected: null, downgraded: false })
  assert.deepEqual(describe({ format: 'flac', sampleRate: null, bytesRead: 0, error: 'HTTP 403' }, 'master'), { quality: 'master', detected: null, downgraded: false })
})

test('bitrate falls back to size and duration when the header has none', () => {
  const small = { format: 'mp3', sampleRate: 44100, bitrate: null, contentLength: 3 * 1024 * 1024, bytesRead: 1024, error: null }
  assert.equal(describe(small, '320k').detected, '128k')

  const large = { format: 'mp3', sampleRate: 44100, bitrate: null, contentLength: 10 * 1024 * 1024, bytesRead: 1024, error: null }
  assert.equal(describe(large, '128k').detected, '320k')
  assert.equal(describe(large, '128k').quality, '128k')
})
