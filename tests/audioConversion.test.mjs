import assert from 'node:assert/strict'
import test from 'node:test'
import { formatInfo, normalizeFormat, parseFfmpegTime, shouldDeleteSource } from '../src/common/utils/audioConversion.js'

test('audio conversion formats use the expected output extension and encoder', () => {
  assert.deepEqual(formatInfo.flac, { ext: 'flac', args: ['-c:a', 'flac'] })
  assert.deepEqual(formatInfo.alac, { ext: 'm4a', args: ['-c:a', 'alac'] })
  assert.deepEqual(formatInfo.wavpack, { ext: 'wv', args: ['-c:a', 'wavpack'] })
  assert.deepEqual(formatInfo.mp3.args, ['-c:a', 'libmp3lame', '-b:a', '320k'])
  assert.deepEqual(formatInfo.aac.args, ['-c:a', 'aac', '-b:a', '320k'])
  assert.equal(normalizeFormat('unknown'), 'flac')
})

test('ffmpeg progress parser converts timestamps to seconds', () => {
  assert.equal(parseFfmpegTime('size=1kB time=01:02:03.50 bitrate=1kbits/s'), 3723.5)
  assert.equal(parseFfmpegTime('no progress yet'), null)
})

test('download source deletion requires both the task snapshot and current setting', () => {
  assert.equal(shouldDeleteSource(false, true, true), false)
  assert.equal(shouldDeleteSource(true, true, false), false)
  assert.equal(shouldDeleteSource(true, true, true), true)
})
