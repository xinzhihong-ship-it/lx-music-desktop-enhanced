const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createHarness, settle, chromeDevices, nativeDevices } = require('./helpers/audioDeviceHarness.cjs')

test('the real service and binder reject a reused ID before binding or saving its new description', async() => {
  const device = createHarness({}, { electron: async() => [{ kind: 'audiooutput', deviceId: 'browser-a', label: 'Unrelated speakers' }] })
  device.mount(); await settle(); await settle()
  assert.deepEqual(device.applied, [])
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
  assert.notEqual(device.setting['player.mediaDeviceId'], 'default')
  device.dispose()
})

test('repeated playback validation cannot accept a native ID that was rejected as reused', async() => {
  const device = createHarness({ 'player.playEngine': 'mpv', 'player.mediaDeviceId': 'avfoundation/wanted' }, { mpv: async() => [{ id: 'avfoundation/wanted', name: 'Unrelated speakers' }] })
  device.mount(); await settle()
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(device.api.ensureForPlayback('mpv'), error => error.code === 'AUDIO_DEVICE_UNAVAILABLE')
    assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
    assert.notEqual(device.setting['player.mediaDeviceId'], 'avfoundation/wanted')
  }
  device.dispose()
})

test('empty labels keep the remembered name visible and do not bind an unverified output', async() => {
  const device = createHarness({}, { electron: async() => [{ kind: 'audiooutput', deviceId: 'browser-a', label: '' }] })
  device.mount(); await settle(); await settle()
  assert.ok(device.api.mediaDevices.value.find(row => row.deviceId === device.api.mediaDeviceId.value).label.includes('Wanted output'))
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
  assert.deepEqual(device.applied, [])
  device.dispose()
})

test('a background description update cannot silently cancel a current playback check', async() => {
  const device = createHarness()
  device.mount(); await settle(); await settle()
  const play = device.api.ensureForPlayback()
  device.update({ 'player.mediaDeviceLabel.mpv': 'Updated description' })
  assert.equal(await play, true)
  assert.equal(device.setting['player.mediaDeviceId'], 'browser-a')
  device.dispose()
})

test('an empty first MPV enumeration is retried on the next playback', async() => {
  let attempts = 0
  const device = createHarness({ 'player.playEngine': 'mpv', 'player.mediaDeviceId': 'avfoundation/wanted' }, { mpv: async() => ++attempts === 1 ? [] : nativeDevices() })
  device.mount(); await settle()
  assert.equal(await device.api.ensureForPlayback('mpv'), true)
  assert.ok(attempts >= 2)
  assert.equal(device.setting['player.mediaDeviceId'], 'avfoundation/wanted')
  device.dispose()
})

test('an older bind completion cannot save over a newer explicit choice', async() => {
  let complete
  const device = createHarness({}, { bind: id => id === 'browser-a' ? new Promise(resolve => { complete = resolve }) : Promise.resolve() })
  device.mount(); await settle()
  device.update({ 'player.mediaDeviceId': 'browser-b' })
  await settle()
  complete(); await settle(); await settle()
  assert.equal(device.setting['player.mediaDeviceId'], 'browser-b')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Other output')
  device.dispose()
})

test('rapid explicit device choices commit only the latest validated selection', async() => {
  let complete
  const device = createHarness({}, { bind: id => id === 'browser-a' ? new Promise(resolve => { complete = resolve }) : Promise.resolve() })
  device.mount(); await settle()
  const older = device.api.selectMediaDevice('browser-a').catch(error => error.code)
  const latest = device.api.selectMediaDevice('browser-b')
  await latest
  complete(); await older; await settle()
  assert.equal(device.setting['player.mediaDeviceId'], 'browser-b')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Other output')
  device.dispose()
})

test('a device change in Electron forces a new MPV probe before switching', async() => {
  const requests = []
  const device = createHarness({}, { mpv: async options => { requests.push(options); return nativeDevices() } })
  device.mount(); await settle()
  await device.api.prepareEngineChange('mpv')
  device.changed(); await settle()
  await device.api.prepareEngineChange('mpv')
  assert.equal(requests.at(-1).forceRefresh, true)
  device.dispose()
})

test('a sink binding failure keeps the previous configuration and reports a device error', async() => {
  const device = createHarness({}, { bind: async() => { throw new Error('sink rejected') } })
  device.mount(); await settle()
  await assert.rejects(device.api.selectMediaDevice('browser-b'), error => error.code === 'AUDIO_DEVICE_UNAVAILABLE')
  assert.equal(device.setting['player.mediaDeviceId'], 'browser-a')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
  device.dispose()
})

test('device removal still pauses playback without changing the selected output to default', async() => {
  let devices = chromeDevices()
  const device = createHarness({}, { electron: async() => devices, playing: true })
  device.mount(); await settle(); await settle()
  devices = []; device.changed(); await settle(); await settle()
  assert.ok(device.events.paused > 0)
  assert.ok(device.events.changed > 0)
  assert.notEqual(device.setting['player.mediaDeviceId'], 'default')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
  device.dispose()
})
