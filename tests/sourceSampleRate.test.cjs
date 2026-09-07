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
const { parseAudioSampleRate, probeAudioSourceSampleRate } = loadedModule.exports

const findBinary = name => {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = [
    process.env[name.toUpperCase()],
    process.platform === 'darwin' && `/opt/homebrew/bin/${fileName}`,
    process.platform === 'darwin' && `/usr/local/bin/${fileName}`,
    path.resolve('resources', 'ffmpeg', `${process.platform}-${process.arch}`, fileName),
  ].filter(Boolean)
  return candidates.find(file => fs.existsSync(file)) ?? null
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

const ffmpeg = findBinary('ffmpeg')
const codecTest = ffmpeg ? test : test.skip

codecTest('playback sample rate is correct for Opus and AAC, not metadata-parser aliases', async() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-source-rate-codecs-'))
  try {
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=997:duration=0.2:sample_rate=8000', '-ac', '2', '-ar', '8000', path.join(root, 'in8.wav')])
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'in8.wav'), '-c:a', 'libopus', '-b:a', '128k', path.join(root, 'op.ogg')])
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=997:duration=0.2:sample_rate=96000', '-ac', '2', '-ar', '96000', path.join(root, 'in96.wav')])
    cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'in96.wav'), '-c:a', 'aac', '-b:a', '256k', path.join(root, 'a.m4a')])
    assert.equal(await probeAudioSourceSampleRate(path.join(root, 'op.ogg')), 48000)
    assert.equal(await probeAudioSourceSampleRate(path.join(root, 'a.m4a')), 96000)
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
