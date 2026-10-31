const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { load } = require('./helpers/audioDeviceHarness.cjs')

function controllerModule() {
  const nativePath = path.join('/test', 'bin', 'mpv.app', 'Contents', 'MacOS', 'mpv')
  const fakeFs = { existsSync: file => file === nativePath, statSync: file => ({ isFile: () => file === nativePath, mode: 0o755, mtimeMs: 1, size: 1 }), realpathSync: file => file }
  const module = load('src/main/modules/winMain/mpvController.ts', {
    electron: { app: { isPackaged: true, getPath: () => '/test/app', on() {} } },
    'node:child_process': { spawn() { throw Error('Unexpected subprocess') } },
    'node:fs': { ...fakeFs, default: fakeFs },
    'node:path': { ...path, default: path },
    'node:os': { default: { tmpdir: () => '/tmp', release: () => '24.6.0' } },
    'node:net': {},
    '@common/utils': { log: { info() {}, warn() {}, error() {} } },
    '@main/modules/winMain/main': { sendEvent() {} },
    '@main/utils': { getProxy: () => null },
    '@main/modules/account/sessions': {},
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: {} },
    '@common/utils/mpvCompatibility': { getBundledMacMpvAppNames: () => ['mpv.app'] },
    '@common/utils/mpvAudioDevice': {},
    '@common/utils/audioDeviceSelection': load('src/common/utils/audioDeviceSelection.ts'),
    '@main/utils/audioDeviceCache': load('src/main/utils/audioDeviceCache.ts'),
    '@common/utils/mpvDeviceList': load('src/common/utils/mpvDeviceList.ts'),
  }, { process: { platform: 'darwin', arch: 'arm64', env: { NODE_ENV: 'production' }, resourcesPath: '/test', cwd: () => '/test' }, global: { lx: { appSetting: { 'player.mpv.path': '' } } }, Buffer })
  return { ...module, nativePath }
}

test('running MPV supplies a fresh device catalog through IPC without spawning a probe', async() => {
  const { MpvController, getMpvController, resolveMpvPath, nativePath } = controllerModule()
  assert.equal(resolveMpvPath().path, nativePath)
  const player = getMpvController()
  const commands = []
  player.socket = {}
  player.process = { killed: false }
  player.cachedPathInfo = { path: nativePath, source: 'bundled' }
  player.command = async(command, timeout) => {
    commands.push({ command, timeout })
    return [{ name: 'auto', description: 'Auto' }, { name: 'coreaudio/runtime', description: 'Runtime Output' }, { name: 'avfoundation/runtime', description: 'Runtime Output' }]
  }
  for (let song = 0; song < 3; song++) {
    const devices = await MpvController.listAudioDevices()
    assert.equal(devices[1].id, 'avfoundation/runtime')
  }
  assert.equal(commands.length, 3)
  assert.equal(commands[0].command[1], 'audio-device-list')
  assert.equal(commands[0].timeout, 750)
  assert.equal(await player.getLiveAudioDevices('/different/mpv'), null)
})

test('missing or failed live IPC uses the existing external probe fallback', async() => {
  const { MpvController, getMpvController, nativePath } = controllerModule()
  const player = getMpvController()
  let probes = 0
  MpvController.probeAudioDevices = async() => { probes++; return [{ id: 'auto', name: 'Auto' }, { id: 'avfoundation/fallback', name: 'Fallback' }] }
  assert.equal((await MpvController.listAudioDevices())[1].id, 'avfoundation/fallback')
  player.socket = {}; player.process = { killed: false }; player.cachedPathInfo = { path: nativePath }
  player.command = async() => { throw Error('IPC unavailable') }
  assert.equal((await MpvController.listAudioDevices({ forceRefresh: true }))[1].id, 'avfoundation/fallback')
  assert.equal(probes, 2)
})
