const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const cp = require('node:child_process')
const ts = require('typescript')

const source = fs.readFileSync('src/main/utils/audioSourceSampleRate.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const loadedModule = { exports: {} }
new Function('module', 'exports', 'require', compiled)(loadedModule, loadedModule.exports, require)
const { parseAudioSampleRate, probeAudioSourceSampleRate, probeAudioSourceInfo } = loadedModule.exports

const findBinary = name => {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = [
    process.env[name.toUpperCase()],
    process.platform === 'darwin' && `/opt/homebrew/bin/${fileName}`,
    process.platform === 'darwin' && `/usr/local/bin/${fileName}`,
    path.resolve('resources', 'ffmpeg', `${process.platform}-${process.arch}`, fileName),
  ].filter(Boolean)
  return candidates.find(file => {
    if (!fs.existsSync(file)) return false
    // A bundled macOS binary can exist while one of its dylib dependencies is
    // missing.  Treat that as unavailable so codec fixture tests are skipped
    // with a clear environment limitation instead of failing before testing
    // the parser itself.
    const result = cp.spawnSync(file, ['-version'], { stdio: 'ignore' })
    return result.status === 0
  }) ?? null
}

const wave = rate => {
  const bytes = Buffer.alloc(76)
  bytes.write('RIFF')
  bytes.writeUInt32LE(68, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 4, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(32, 40)
  return bytes
}

test('format header parsers return the playback sample rate', () => {
  assert.equal(parseAudioSampleRate(wave(96000)), 96000)
  assert.equal(parseAudioSampleRate(new Uint8Array()), null)
  assert.equal(parseAudioSampleRate(Buffer.from('not audio')), null)
})

test('invalid container metadata is not accepted as a sample rate', () => {
  const bytes = Buffer.alloc(6)
  bytes[0] = 0xb5
  bytes[1] = 0x84
  bytes.writeFloatBE(139334, 2)
  assert.equal(parseAudioSampleRate(bytes), null)
})

test('metadata markers inside an HTML response are not accepted as audio', () => {
  const bytes = Buffer.from('<html>OpusHead OggS mp4a 1A45DFA3</html>')
  assert.equal(parseAudioSampleRate(bytes), null)
})

test('HTTP errors are reported as probe failures instead of URL-format evidence', async() => {
  const server = http.createServer((_request, response) => response.writeHead(403).end())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await probeAudioSourceInfo(`http://127.0.0.1:${server.address().port}/song.mp3`)
    assert.equal(result.error, 'HTTP 403')
    assert.equal(result.bytesRead, 0)
    assert.equal(result.format, null)
  } finally { server.close() }
})

test('a HEAD rejection does not fail a readable ranged audio response', async() => {
  const bytes = wave(44100)
  const server = http.createServer((request, response) => {
    if (request.method === 'HEAD') return response.writeHead(405).end()
    response.writeHead(206, {
      'content-type': 'audio/wav',
      'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'content-length': bytes.length,
    })
    response.end(bytes)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await probeAudioSourceInfo(`http://127.0.0.1:${server.address().port}/song.wav`)
    assert.equal(result.sampleRate, 44100)
    assert.equal(result.error, null)
    assert.equal(result.httpStatus, 206)
  } finally { server.close() }
})

const ffmpeg = findBinary('ffmpeg')
const codecTest = ffmpeg ? test : test.skip

// 项目自编的 ffmpeg 只启用 libmp3lame（应用内的转换也不提供 Opus 编码），只有系统 ffmpeg 才有
// libopus。缺少该编码器时跳过 Opus 用例，避免把环境限制当成解析器回归。
const supportsEncoder = name => {
  if (!ffmpeg) return false
  const result = cp.spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  return result.status === 0 && (result.stdout ?? '').includes(name)
}
const opusTest = supportsEncoder('libopus') ? test : test.skip

codecTest('playback sample rate is correct for AAC, not metadata-parser aliases', async() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-source-rate-codecs-'))
  try {
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=997:duration=0.2:sample_rate=96000', '-ac', '2', '-ar', '96000', path.join(root, 'in96.wav')])
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'in96.wav'), '-c:a', 'aac', '-b:a', '256k', path.join(root, 'a.m4a')])
    assert.equal(await probeAudioSourceSampleRate(path.join(root, 'a.m4a')), 96000)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

opusTest('playback sample rate is correct for Opus, not metadata-parser aliases', async() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-source-rate-codecs-'))
  try {
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=997:duration=0.2:sample_rate=8000', '-ac', '2', '-ar', '8000', path.join(root, 'in8.wav')])
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'in8.wav'), '-c:a', 'libopus', '-b:a', '128k', path.join(root, 'op.ogg')])
    assert.equal(await probeAudioSourceSampleRate(path.join(root, 'op.ogg')), 48000)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

codecTest('remote Range headers use the same lightweight parser without a temp file', async() => {
  const bytes = wave(88200)
  const server = http.createServer((request, response) => {
    const range = /^bytes=(\d+)-(\d+)?$/i.exec(request.headers.range ?? '')
    const start = range ? Number(range[1]) : 0
    const end = Math.min(range?.[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1)
    if (start >= bytes.length) return response.writeHead(416).end()
    response.writeHead(range ? 206 : 200, {
      'content-type': 'audio/mpeg',
      'content-range': `bytes ${start}-${end}/${bytes.length}`,
      'content-length': end - start + 1,
    })
    response.end(bytes.subarray(start, end + 1))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { assert.equal(await probeAudioSourceSampleRate(`http://127.0.0.1:${server.address().port}/song`), 88200) } finally { server.close() }
})

codecTest('Bilibili-style CDN headers are required and forwarded to the probe', async() => {
  const bytes = wave(48000)
  let sawHeaders = false
  const server = http.createServer((request, response) => {
    sawHeaders = request.headers.referer === 'https://www.bilibili.com/' && request.headers.origin === 'https://www.bilibili.com'
    if (!sawHeaders) return response.writeHead(403).end()
    response.writeHead(206, {
      'content-type': 'video/mp4',
      'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      'content-length': bytes.length,
    })
    response.end(bytes)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    assert.equal(await probeAudioSourceSampleRate(`http://127.0.0.1:${server.address().port}/audio.m4s`, {
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      'User-Agent': 'test',
    }), 48000)
    assert.equal(sawHeaders, true)
  } finally { server.close() }
})

test('unsupported local sources resolve to unknown at the IPC boundary', async() => {
  await assert.rejects(probeAudioSourceSampleRate('/not/a/real/audio'), /ENOENT|no such file/i)
})
