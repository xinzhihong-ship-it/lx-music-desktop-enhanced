const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createHarness, settle, chromeDevices } = require('./helpers/audioDeviceHarness.cjs')

test('out-of-order output enumeration binds and saves only the latest selection', async() => {
  const enumerations = []
  const device = createHarness({}, { electron: () => new Promise(resolve => enumerations.push(resolve)) })
  device.mount(); await settle()
  device.update({ 'player.mediaDeviceId': 'browser-b' })
  await settle()
  enumerations[0](chromeDevices())
  await settle(); await settle()
  assert.ok(device.applied.every(id => id === 'browser-b'))
  assert.equal(device.setting['player.mediaDeviceId'], 'browser-b')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Other output')
  device.dispose()
})

test('a temporarily missing device is retried without binding or persisting default', async() => {
  const device = createHarness({}, { electron: async() => [{ kind: 'audiooutput', deviceId: 'default', label: 'Default' }] })
  device.mount(); await settle(); await settle()
  assert.deepEqual(device.applied, [])
  assert.notEqual(device.setting['player.mediaDeviceId'], 'default')
  assert.equal(device.setting['player.mediaDeviceLabel'], 'Wanted output')
  device.dispose()
})

test('MPV to Electron binds the mapped Chromium output and suspends binding in MPV', async() => {
  const device = createHarness({ 'player.playEngine': 'mpv', 'player.mediaDeviceId': 'avfoundation/wanted' })
  device.mount(); await settle()
  assert.deepEqual(device.applied, [])
  device.update({ ...await device.api.prepareEngineChange('electron'), 'player.playEngine': 'electron' })
  await settle(); await settle()
  assert.ok(device.applied.includes('browser-a'))
  const count = device.applied.length
  device.update({ ...await device.api.prepareEngineChange('mpv'), 'player.playEngine': 'mpv' })
  await settle()
  assert.equal(device.applied.length, count)
  device.dispose()
})
