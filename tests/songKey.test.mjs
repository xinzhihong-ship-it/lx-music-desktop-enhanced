import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const inMemoryUserKeys = {}
const virtualModules = new Map([
  ['@renderer/utils/ipc', `
    export const getUserSongKeys = async () => globalThis.__songKeyTestStore;
    export const saveUserSongKeys = (keys) => { globalThis.__songKeyTestStore = keys; };
    export const fetchSongKeyAudio = async () => null;
  `],
  ['@common/rendererIpc', `
    export const rendererInvoke = async () => true;
  `],
])
globalThis.__songKeyTestStore = inMemoryUserKeys

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

const {
  getSemitonesFromPlaybackRate,
  transposeKey,
  analyzeAudioKey,
} = await import('../src/renderer/utils/musicKey/ksAlgorithm.ts')

const {
  findDatabaseSongKey,
} = await import('../src/renderer/utils/musicKey/database.ts')

const {
  resolveSongKey,
  setUserKey,
  clearUserKey,
} = await import('../src/renderer/utils/musicKey/index.ts')

test('K-S algorithm detects Major and Minor keys accurately from synthetic tones', () => {
  const sampleRate = 22050
  const duration = 1.5
  const numSamples = Math.floor(sampleRate * duration)

  // 1. Generate G Major chord: G3 (196Hz), B3 (246.94Hz), D4 (293.66Hz)
  const gMajorSamples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    gMajorSamples[i] =
      0.5 * Math.sin(2 * Math.PI * 196.0 * t) +
      0.3 * Math.sin(2 * Math.PI * 246.94 * t) +
      0.3 * Math.sin(2 * Math.PI * 293.66 * t)
  }
  const gMajResult = analyzeAudioKey(gMajorSamples, sampleRate)
  assert.equal(gMajResult.key, 'G')
  assert.equal(gMajResult.scale, 'major')
  assert.equal(gMajResult.label, '1=G 大调')
  assert.equal(gMajResult.camelot, '9B')
  assert.ok(gMajResult.confidence > 0.7)

  // 2. Generate A Minor chord: A3 (220Hz), C4 (261.63Hz), E4 (329.63Hz)
  const aMinorSamples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    aMinorSamples[i] =
      0.5 * Math.sin(2 * Math.PI * 220.0 * t) +
      0.3 * Math.sin(2 * Math.PI * 261.63 * t) +
      0.3 * Math.sin(2 * Math.PI * 329.63 * t)
  }
  const aMinResult = analyzeAudioKey(aMinorSamples, sampleRate)
  assert.equal(aMinResult.key, 'A')
  assert.equal(aMinResult.scale, 'minor')
  assert.equal(aMinResult.label, 'Am 小调')
  assert.equal(aMinResult.camelot, '8A')
  assert.ok(aMinResult.confidence > 0.7)
})

test('transposeKey calculates shifted key correctly across semitones', () => {
  // C major + 2 semitones -> D major
  const trans1 = transposeKey('C', 'major', 2)
  assert.equal(trans1.key, 'D')
  assert.equal(trans1.label, '1=D 大调')
  assert.equal(trans1.camelot, '10B')

  // G major - 2 semitones -> F major
  const trans2 = transposeKey('G', 'major', -2)
  assert.equal(trans2.key, 'F')
  assert.equal(trans2.label, '1=F 大调')
  assert.equal(trans2.camelot, '7B')

  // A minor + 1 semitone -> A# / Bb minor
  const trans3 = transposeKey('A', 'minor', 1)
  assert.equal(trans3.key, 'A#')
  assert.equal(trans3.label, 'Bbm 小调')

  // Wrap around octave: B major + 1 semitone -> C major
  const trans4 = transposeKey('B', 'major', 1)
  assert.equal(trans4.key, 'C')
  assert.equal(trans4.label, '1=C 大调')
})

test('getSemitonesFromPlaybackRate converts speed factor to semitones accurately', () => {
  assert.equal(getSemitonesFromPlaybackRate(1), 0)
  assert.equal(getSemitonesFromPlaybackRate(1.059463), 1) // 2^(1/12)
  assert.equal(getSemitonesFromPlaybackRate(1.122462), 2) // 2^(2/12)
  assert.equal(getSemitonesFromPlaybackRate(0.943874), -1) // 2^(-1/12)
  assert.equal(getSemitonesFromPlaybackRate(0.890899), -2) // 2^(-2/12)
})

test('findDatabaseSongKey returns accurate canonical key for known songs', () => {
  const qingtian = findDatabaseSongKey('晴天', '周杰伦')
  assert.ok(qingtian)
  assert.equal(qingtian.key, 'G')
  assert.equal(qingtian.scale, 'major')
  assert.equal(qingtian.label, '1=G 大调')
  assert.equal(qingtian.source, 'database')

  const qilishang = findDatabaseSongKey('七里香', '周杰伦')
  assert.ok(qilishang)
  assert.equal(qilishang.key, 'D#')
  assert.equal(qilishang.scale, 'major')
  assert.equal(qilishang.label, '1=Eb 大调')

  const shinian = findDatabaseSongKey('十年', '陈奕迅')
  assert.ok(shinian)
  assert.equal(shinian.key, 'G#')
  assert.equal(shinian.label, '1=Ab 大调')

  // Unknown song returns null
  assert.equal(findDatabaseSongKey('完全未知的歌曲xyz', '未知歌手abc'), null)
})

test('user key memory takes top priority and supports clear/restore', async() => {
  // Initially for a known song, it uses database
  const initial = await resolveSongKey('晴天', '周杰伦')
  assert.ok(initial)
  assert.equal(initial.source, 'database')
  assert.equal(initial.key, 'G')

  // User manually customizes key to D major and remembers it
  await setUserKey('晴天', '周杰伦', 'D', 'major')
  const customized = await resolveSongKey('晴天', '周杰伦')
  assert.ok(customized)
  assert.equal(customized.source, 'user')
  assert.equal(customized.key, 'D')
  assert.equal(customized.label, '1=D 大调')
  assert.equal(customized.custom, true)

  // User sets key for an unknown song
  await setUserKey('我的自制曲目', '自己', 'F#', 'minor')
  const unknownCustom = await resolveSongKey('我的自制曲目', '自己')
  assert.ok(unknownCustom)
  assert.equal(unknownCustom.source, 'user')
  assert.equal(unknownCustom.key, 'F#')
  assert.equal(unknownCustom.label, 'F#m 小调')

  // User clears manual key for 晴天 -> reverts back to database
  await clearUserKey('晴天', '周杰伦')
  const reverted = await resolveSongKey('晴天', '周杰伦')
  assert.ok(reverted)
  assert.equal(reverted.source, 'database')
  assert.equal(reverted.key, 'G')
})

