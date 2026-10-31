const assert = require('node:assert/strict')
const { test } = require('node:test')
const { load } = require('./helpers/audioDeviceHarness.cjs')
const device = load('src/common/utils/audioDeviceSelection.ts')

for (const value of [null, undefined, 42, [], {}, 'x'.repeat(4097), 'device\u0000injected']) {
  test('invalid imported audio output keeps the last valid selection: ' + typeof value, () => {
    const patch = device.sanitizeAudioDeviceSettings({ 'player.mediaDeviceId': value, 'player.mediaDeviceLabel': value }, { 'player.mediaDeviceId': 'valid-device', 'player.mediaDeviceLabel': 'Saved name' })
    assert.equal(patch['player.mediaDeviceId'], 'valid-device')
    assert.equal(patch['player.mediaDeviceLabel'], 'Saved name')
    assert.doesNotThrow(() => device.getRequestedAudioDevice(value))
  })
}

test('missing fields are preserved as a partial update and empty ID uses default', () => {
  assert.deepEqual(Object.keys(device.sanitizeAudioDeviceSettings({ 'player.volume': 0.37 })), ['player.volume'])
  assert.equal(device.sanitizeAudioDeviceSettings({ 'player.mediaDeviceId': '' })['player.mediaDeviceId'], 'default')
  assert.equal(device.sanitizeAudioDeviceSettings({ 'player.mediaDeviceId.mpv': '' })['player.mediaDeviceId.mpv'], '')
})

test('renderer configuration merge and IPC persistence apply the same device validation', () => {
  const saves = []
  const setting = load('src/renderer/store/setting.ts', {
    '@common/utils/vueTools': require('vue'),
    '@common/defaultSetting': { default: { 'player.mediaDeviceId': 'valid-device', 'player.mediaDeviceLabel': 'Saved name' } },
    '@renderer/utils/ipc': { updateSetting: patch => { saves.push(patch); return Promise.resolve() } },
    '@common/utils/audioDeviceSelection': device,
  }, { window: { lxData: {} } })
  setting.updateSetting({ 'player.mediaDeviceId': null, 'player.mediaDeviceLabel': ['invalid'] })
  assert.equal(setting.appSetting['player.mediaDeviceId'], 'valid-device')
  assert.equal(saves[0]['player.mediaDeviceLabel'], 'Saved name')
})

test('main-process configuration merge validates old JSON and preserves unrelated fields', () => {
  const { mergeSetting } = load('src/main/utils/index.ts', {
    '@common/utils': { throttle: callback => callback },
    '@common/utils/migrateSetting': {},
    '@main/utils/store': {},
    '@common/constants': {},
    '@common/defaultSetting': {},
    '@common/defaultHotKey': {},
    './migrate': {},
    electron: {},
    '@common/utils/nodejs': {},
    '@common/theme/index.json': {},
    '@common/utils/audioDeviceSelection': device,
  })
  const result = mergeSetting({ 'player.mediaDeviceId': 'valid-device', 'player.mediaDeviceLabel': 'Saved name', 'player.volume': 1 }, { 'player.mediaDeviceId': null, 'player.mediaDeviceLabel': 7, 'player.volume': 0.37 })
  assert.equal(result.setting['player.mediaDeviceId'], 'valid-device')
  assert.equal(result.setting['player.mediaDeviceLabel'], 'Saved name')
  assert.equal(result.setting['player.volume'], 0.37)
})
