const assert = require('node:assert/strict')
const { test } = require('node:test')
const { load } = require('./helpers/audioDeviceHarness.cjs')

function videoBridge() {
  const devices = []
  const loads = []
  const native = { create() {}, setBounds() {}, setAudioDevice: id => devices.push(id), load: value => loads.push(value), poll: () => [], destroy() {} }
  const settings = {
    'player.mediaDeviceId': 'browser-a',
    'player.mediaDeviceId.electron': 'browser-a',
    'player.mediaDeviceId.mpv': 'avfoundation/usb',
    'player.mpv.aoFallbackDevices': ['avfoundation/usb'],
  }
  const bridge = load('src/main/modules/winMain/mpvVideoController.ts', {
    electron: { app: { isPackaged: false, on() {} } },
    'node:fs': { default: { existsSync: () => true }, existsSync: () => true },
    'node:path': { ...require('node:path'), default: require('node:path') },
    '@common/utils': { log: { info() {}, debug() {}, warn() {}, error() {} } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: {} },
    '@common/utils/audioDeviceSelection': load('src/common/utils/audioDeviceSelection.ts'),
    './main': { getBrowserWindow: () => ({ getNativeWindowHandle: () => Buffer.alloc(8) }), sendEvent() {} },
    './mpvController': {},
    '@main/modules/account/sessions': {},
  }, { process: { platform: 'darwin', cwd: () => '/test' }, __dirname: '/test', Buffer, global: { lx: { appSetting: settings } }, __non_webpack_require__: () => native, setInterval: () => 1, clearInterval() {} })
  return { bridge, devices, loads }
}

test('native video keeps the mapped AVFoundation output instead of forcing an incompatible CoreAudio AO', async() => {
  const { bridge, devices, loads } = videoBridge()
  await bridge.loadUrl('https://example.com/video.mp4')
  assert.equal(devices[0], 'avfoundation/usb')
  assert.equal(loads.length, 1)
  bridge.setAudioDevice('browser-a')
  assert.equal(devices[1], 'avfoundation/usb')
})
