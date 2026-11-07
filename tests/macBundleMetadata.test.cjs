const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { removeAppleDoubleFiles, markAgentApp } = require('../build-config/mac-bundle-metadata')

test('Mac signing cleanup removes only AppleDouble files inside the staged bundle', async() => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-sign-metadata-'))
  const app = path.join(root, 'app')
  const outside = path.join(root, 'outside')
  try {
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', '._.gitkeep'), 'sidecar')
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', '.gitkeep'), '')
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'mpv'), 'real binary')
    await fs.writeFile(path.join(outside, '._keep'), 'outside')
    await fs.symlink(outside, path.join(app, 'linked'), 'dir')
    assert.equal(await removeAppleDoubleFiles(app), 1)
    assert.equal(await fs.readFile(path.join(app, 'Contents', 'MacOS', 'mpv'), 'utf8'), 'real binary')
    await fs.access(path.join(app, 'Contents', 'MacOS', '.gitkeep'))
    await fs.access(path.join(outside, '._keep'))
    assert.equal(await removeAppleDoubleFiles(app), 0)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('mpv.app is marked as a background agent (LSUIElement) and re-signed before the outer app is sealed', async() => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-agent-app-'))
  const app = path.join(root, 'mpv.app')
  try {
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), '<plist/>')
    // CI 日志：mpv-macos26.app/Contents/MacOS/._.gitkeep 让重新签名失败（code object is not signed at all）
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'mpv'), 'binary')
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', '.gitkeep'), '')
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', '._.gitkeep'), 'sidecar')
    const calls = []
    assert.equal(await markAgentApp(app, async(cmd, args) => { calls.push([cmd, ...args]) }), true)
    assert.deepEqual(calls[0], ['plutil', '-replace', 'LSUIElement', '-bool', 'YES', path.join(app, 'Contents', 'Info.plist')])
    assert.equal(calls[1][0], 'codesign')
    assert.ok(!calls[1].some(arg => /requirements/.test(arg)), 'original requirements are not preserved')
    assert.equal(calls[1].at(-1), app)
    assert.deepEqual(calls[2], ['codesign', '--verify', '--strict', app])
    assert.deepEqual(await fs.readdir(path.join(app, 'Contents', 'MacOS')), ['mpv'], 'stray files are removed before signing')
    await assert.rejects(markAgentApp(path.join(root, 'missing.app'), async() => {}))

    // 重新签名或校验失败：还原原来的 .app，不让打包失败
    const warnings = []
    const result = await markAgentApp(app, async(cmd, args) => {
      if (cmd == 'plutil') await fs.writeFile(args.at(-1), '<plist>changed</plist>')
      if (args[0] == '--verify') throw Object.assign(new Error('verify failed'), { stderr: 'does not satisfy its designated Requirement' })
    }, { warn: msg => warnings.push(msg) })
    assert.equal(result, false)
    assert.equal(await fs.readFile(path.join(app, 'Contents', 'Info.plist'), 'utf8'), '<plist/>')
    assert.match(warnings[0], /designated Requirement/)
    await assert.rejects(fs.access(`${app}.lsuielement-backup`))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
