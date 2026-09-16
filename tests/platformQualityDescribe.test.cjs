const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

const loadTs = (path, shims = {}) => {
  const source = fs.readFileSync(path, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  const requireShim = id => (id in shims ? shims[id] : require(id))
  new Function('module', 'exports', 'require', compiled)(loadedModule, loadedModule.exports, requireShim)
  return loadedModule.exports
}

const platformQualitys = loadTs('src/common/quality/platformQualitys.ts')
const actualQuality = loadTs('src/renderer/core/player/actualQuality.ts')
const { evaluateAudioSpec, describePlatformQuality } = loadTs('src/renderer/core/quality/platformQualityVerdict.ts', {
  '@common/quality/platformQualitys': platformQualitys,
  '@renderer/core/player/actualQuality': actualQuality,
})

const probe = (format, { sampleRate = 44_100, bitsPerSample = null, bitrate = null, contentLength = null } = {}) => ({
  format, sampleRate, bitrate, bitsPerSample, contentLength, bytesRead: 1024, error: null,
})
const flacProbe = (sampleRate, bits) => probe('flac', { sampleRate, bitsPerSample: bits })
const mp3Probe = bitrate => probe('mp3', { bitrate })
const m4aProbe = sampleRate => probe('m4a', { sampleRate })

const describe = (probeValue, source, qualityId, interval = '04:00') =>
  describePlatformQuality({ probe: probeValue, interval, source, qualityId })

//
// 下面这些样本的规格来自对平台接口与官方客户端的实测，用来锁住「按平台口径判定」的口径：
// 同样一个 24bit FLAC，在 QQ 算 SQ 无损达标，在酷狗的 Hi-Res 档才算达标。
//

test('QQ 的 SQ 无损即使交付 24bit 文件也算通过', () => {
  const result = describe(flacProbe(44_100, 24), 'tx', 'size_flac')
  assert.equal(result.kind, 'pass')
  assert.equal(result.tier, 'flac')
})

test('QQ 的 Hi-Res 要求 24bit，16bit 视为降级', () => {
  assert.equal(describe(flacProbe(96_000, 24), 'tx', 'size_hires').kind, 'pass')
  const downgraded = describe(flacProbe(44_100, 16), 'tx', 'size_hires')
  assert.equal(downgraded.kind, 'downgrade')
  assert.equal(downgraded.tier, 'flac')
})

test('QQ 的臻品母带按 24bit 要求判定', () => {
  assert.equal(describe(flacProbe(192_000, 24), 'tx', 'size_new0').kind, 'pass')
  assert.equal(describe(flacProbe(44_100, 16), 'tx', 'size_new0').kind, 'downgrade')
})

test('酷狗的 Hi-Res 与无损分属不同位深要求', () => {
  assert.equal(describe(flacProbe(44_100, 16), 'kg', 'flac').kind, 'pass')
  assert.equal(describe(flacProbe(44_100, 16), 'kg', 'high').kind, 'downgrade')
  assert.equal(describe(flacProbe(96_000, 24), 'kg', 'high').kind, 'pass')
})

test('酷狗的蝰蛇母带遇到回落成 320K 的曲目要判降级', () => {
  const result = describe(mp3Probe(320_000), 'kg', 'viper_tape')
  assert.equal(result.kind, 'downgrade')
  assert.equal(result.tier, '320k')
})

test('网易的高清臻音是 24bit 无损，归 hires 而不是全景声', () => {
  const result = describe(flacProbe(96_000, 24), 'wy', 'je')
  assert.equal(result.kind, 'pass')
  assert.equal(result.tier, 'hires')
  assert.equal(result.entry.softwareQuality, 'hires')
})

test('网易的杜比全景声无法仅凭容器证明', () => {
  const result = describe(m4aProbe(48_000), 'wy', 'db')
  assert.equal(result.kind, 'unknown')
  assert.equal(result.tier, null)
})

test('网易的较高音质是 192k，不是 128k', () => {
  assert.equal(describe(mp3Probe(192_000), 'wy', 'm').kind, 'pass')
  // 192k 拿到 128k 流才算降级
  assert.equal(describe(mp3Probe(128_000), 'wy', 'm').kind, 'downgrade')
})

test('无损档位拿到有损流判降级，并给出实际落点', () => {
  const result = describe(mp3Probe(128_000), 'wy', 'sq')
  assert.equal(result.kind, 'downgrade')
  assert.equal(result.tier, '128k')

  const lossy32 = describe(mp3Probe(320_000), 'wy', 'sq')
  assert.equal(lossy32.kind, 'downgrade')
  assert.equal(lossy32.tier, '320k')
})

test('有损档位码率不足判降级，高于要求算通过', () => {
  assert.equal(describe(mp3Probe(128_000), 'wy', 'h').kind, 'downgrade')
  assert.equal(describe(mp3Probe(320_000), 'wy', 'l').kind, 'pass')
  // 无损流满足任何有损档位
  assert.equal(describe(flacProbe(44_100, 16), 'wy', 'h').kind, 'pass')
})

test('酷我的至臻母带与至臻音质按 24bit 无损判定', () => {
  const master = describe(flacProbe(192_000, 24), 'kw', '20900')
  assert.equal(master.kind, 'pass')
  assert.equal(master.tier, 'master')
  assert.equal(describe(flacProbe(44_100, 24), 'kw', '20201').tier, 'atmos_plus')
})

test('酷我的杜比全景声与 DTS:X 不可证', () => {
  for (const id of ['11000', '25000']) {
    assert.equal(describe(m4aProbe(48_000), 'kw', id).kind, 'unknown')
  }
})

test('咪咕的至臻音质是 24bit flac、至臻母带是 32bit wav', () => {
  assert.equal(describe(flacProbe(44_100, 24), 'mg', 'ZQ24').tier, 'hires')
  assert.equal(describe(probe('wav', { sampleRate: 48_000, bitsPerSample: 32 }), 'mg', 'ZQ32').tier, 'master')
  assert.equal(describe(flacProbe(44_100, 16), 'mg', 'ZQ24').kind, 'downgrade')
})

test('咪咕的 3D 音频不可证', () => {
  for (const id of ['Z3D', 'I3D']) assert.equal(describe(m4aProbe(48_000), 'mg', id).kind, 'unknown')
})

test('档位码不在字典里时返回 null', () => {
  assert.equal(describe(mp3Probe(128_000), 'kg', 'not-exist'), null)
  assert.equal(describe(mp3Probe(128_000), 'git', 'flac'), null)
})

test('证据不足时一律无法确认，不误判降级', () => {
  // 探测失败
  const failed = describe({ format: 'flac', sampleRate: null, bitrate: null, bitsPerSample: null, bytesRead: 0, error: 'HTTP 403' }, 'kg', 'flac')
  assert.equal(failed.kind, 'unknown')
  // 容器可辨但编码不可辨（m4a 里可能是 AAC 也可能是 ALAC）
  assert.equal(describe(m4aProbe(44_100), 'tx', 'size_flac').kind, 'unknown')
})

test('evaluateAudioSpec 是纯规格比对，不依赖平台', () => {
  const lossless24 = { lossless: true, minBits: 24, verifiable: true }
  assert.equal(evaluateAudioSpec(lossless24, { lossless: true, bits: 24, bitrate: null, sampleRate: 96_000 }), 'pass')
  assert.equal(evaluateAudioSpec(lossless24, { lossless: true, bits: 16, bitrate: null, sampleRate: 44_100 }), 'downgrade')
  // 位深读不到时不做否定判断
  assert.equal(evaluateAudioSpec(lossless24, { lossless: true, bits: null, bitrate: null, sampleRate: 96_000 }), 'pass')
  assert.equal(evaluateAudioSpec({ lossless: false, verifiable: false }, { lossless: false, bits: null, bitrate: 768_000, sampleRate: 48_000 }), 'unknown')
})
