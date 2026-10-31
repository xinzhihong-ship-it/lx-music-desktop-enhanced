const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const moduleState = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/common/utils/audioDeviceSelection.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleState, exports: moduleState.exports })
const { resolveAudioDeviceSelection: resolve, rememberAudioDevice: remember, getAudioDeviceForEngine } = moduleState.exports
const electron = [{ deviceId: 'chromium-a', label: 'Duet 3' }, { deviceId: 'chromium-b', label: 'BlackHole 16ch' }]
const mpv = [{ deviceId: 'avfoundation/duet', label: 'Duet 3' }, { deviceId: 'avfoundation/blackhole', label: 'BlackHole 16ch' }]
const change = (sourceEngine, targetEngine, deviceId, preference, sourceDevices = sourceEngine === 'electron' ? electron : mpv, targetDevices = targetEngine === 'electron' ? electron : mpv) => resolve({ sourceEngine, targetEngine, deviceId, preference, sourceDevices, targetDevices })

test('the same physical output survives Electron -> MPV -> Electron with different IDs', () => {
  const first = change('electron', 'mpv', 'chromium-a')
  assert.equal(first.deviceId, 'avfoundation/duet')
  assert.equal(first.preference.electron, 'chromium-a')
  const back = change('mpv', 'electron', first.deviceId, first.preference)
  assert.equal(back.deviceId, 'chromium-a')
  assert.equal(back.preference.mpv, 'avfoundation/duet')
})

test('a legacy MPV selection is mapped into Chromium and back without choosing default', () => {
  const first = change('mpv', 'electron', 'avfoundation/blackhole')
  assert.equal(first.deviceId, 'chromium-b')
  assert.equal(change('electron', 'mpv', first.deviceId, first.preference).deviceId, 'avfoundation/blackhole')
})

test('selecting different hardware invalidates the previous cross-engine association', () => {
  const old = change('electron', 'mpv', 'chromium-a').preference
  const selected = remember(old, 'mpv', 'avfoundation/blackhole', 'BlackHole 16ch')
  assert.equal(selected.electron, '')
  assert.equal(change('mpv', 'electron', selected.mpv, selected).deviceId, 'chromium-b')
})

test('two devices with the same name do not reuse an unrelated remembered ID', () => {
  const selected = remember({ label: 'USB Audio', electron: 'old-usb', mpv: 'avfoundation/old-usb' }, 'electron', 'new-usb', 'USB Audio')
  assert.equal(selected.mpv, '')
  const result = change('electron', 'mpv', 'new-usb', selected, [{ deviceId: 'new-usb', label: 'USB Audio' }], [{ deviceId: 'avfoundation/a', label: 'USB Audio' }, { deviceId: 'avfoundation/b', label: 'USB Audio' }])
  assert.equal(result.deviceId, 'new-usb')
  assert.equal(result.preference.label, 'USB Audio')
})

test('temporarily empty enumeration retains the remembered device and its label', () => {
  const saved = change('electron', 'mpv', 'chromium-a').preference
  const missing = change('electron', 'mpv', 'chromium-a', saved, electron, [])
  assert.equal(missing.deviceId, 'avfoundation/duet')
  assert.equal(missing.preference.label, 'Duet 3')
})

test('an unavailable first target keeps the requested hardware instead of persisting default', () => {
  const missing = change('electron', 'mpv', 'chromium-a', undefined, electron, [])
  assert.equal(missing.deviceId, 'chromium-a')
  assert.equal(missing.preference.label, 'Duet 3')
  assert.equal(missing.preference.mpv, '')
})

test('unique labels tolerate whitespace and case differences', () => {
  const result = change('electron', 'mpv', 'chromium-a', undefined, electron, [{ deviceId: 'avfoundation/duet', label: '  duet   3 ' }])
  assert.equal(result.deviceId, 'avfoundation/duet')
})

test('a remembered ID disambiguates devices with duplicate labels', () => {
  const saved = change('electron', 'mpv', 'chromium-a').preference
  const result = change('electron', 'mpv', 'chromium-a', saved, electron, [...mpv, { deviceId: 'avfoundation/another-duet', label: 'Duet 3' }])
  assert.equal(result.deviceId, 'avfoundation/duet')
})

test('CoreAudio and AVFoundation IDs of the same macOS endpoint are equivalent', () => {
  const saved = { label: 'Duet 3', electron: 'chromium-a', mpv: 'coreaudio/duet' }
  assert.equal(change('electron', 'mpv', 'chromium-a', saved).deviceId, 'avfoundation/duet')
})

test('system default maps to MPV auto without pinning a specific computer device', () => {
  assert.equal(change('electron', 'mpv', 'default').deviceId, 'default')
  assert.equal(change('mpv', 'electron', 'auto').deviceId, 'default')
})

test('the communications role resolves through its runtime output group, not MPV auto', () => {
  const browser = [{ deviceId: 'communications', label: 'Communications - Call Output', groupId: 'call-output' }, { deviceId: 'browser-call', label: 'Call Output', groupId: 'call-output' }]
  const native = [{ deviceId: 'wasapi/call', label: 'Call Output' }]
  const forward = change('electron', 'mpv', 'communications', undefined, browser, native)
  assert.equal(forward.deviceId, 'wasapi/call')
  assert.equal(forward.preference.electron, 'communications')
  assert.equal(change('mpv', 'electron', forward.deviceId, forward.preference, native, browser).deviceId, 'communications')
})

test('an unresolvable communications output does not fall back to the default device', () => {
  const forward = change('electron', 'mpv', 'communications', undefined, [{ deviceId: 'communications', label: 'Communications Output' }], [{ deviceId: 'wasapi/default', label: 'Other Output' }])
  assert.ok(forward.deviceId.startsWith('unavailable:'))
  assert.notEqual(forward.deviceId, 'default')
})

for (const [chromiumLabel, nativeLabel] of [
  ['Duet 3 (0c60:002b)', 'Duet 3'],
  ['BlackHole 16ch (Virtual)', 'BlackHole 16ch'],
  ['Mac mini扬声器 (Built-in)', 'Mac mini扬声器'],
  ['聚合设备 (Aggregate)', '聚合设备'],
  ['Wireless Speakers (Bluetooth)', 'Wireless Speakers'],
  ['Studio (Virtual) (Virtual)', 'Studio (Virtual)'],
]) {
  test('Chromium transport metadata maps to the native device: ' + chromiumLabel, () => {
    const chrome = [{ deviceId: 'chromium-device', label: chromiumLabel }]
    const native = [{ deviceId: 'avfoundation/device', label: nativeLabel }]
    const first = change('electron', 'mpv', 'chromium-device', undefined, chrome, native)
    assert.equal(first.deviceId, 'avfoundation/device')
    assert.equal(change('mpv', 'electron', first.deviceId, first.preference, native, chrome).deviceId, 'chromium-device')
  })
}

test('meaningful device-name suffixes are not stripped as transport metadata', () => {
  const result = change('electron', 'mpv', 'headphones', undefined, [{ deviceId: 'headphones', label: 'Studio (Rear)' }], [{ deviceId: 'avfoundation/front', label: 'Studio' }])
  assert.equal(result.deviceId, 'headphones')
})

test('matching requires uniqueness in both live catalogs', () => {
  const result = change('electron', 'mpv', 'browser-one', undefined, [{ deviceId: 'browser-one', label: 'USB Audio' }, { deviceId: 'browser-two', label: 'USB Audio' }], [{ deviceId: 'wasapi/only-one', label: 'USB Audio' }])
  assert.notEqual(result.deviceId, 'wasapi/only-one')
  assert.notEqual(result.deviceId, 'default')
})

test('importing a preference on another computer does not select unrelated hardware', () => {
  const old = { label: 'Previous Output', electron: 'old-browser-id', mpv: 'alsa/hw:0' }
  const result = change('electron', 'mpv', 'old-browser-id', old, [{ deviceId: 'new-browser-id', label: 'Different Output' }], [{ deviceId: 'alsa/hw:0', label: 'Different Output' }])
  assert.notEqual(result.deviceId, 'alsa/hw:0')
  assert.notEqual(result.deviceId, 'default')
  assert.equal(result.preference.mpv, '')
  assert.equal(result.preference.label, 'Previous Output')
})

test('a reused native ID with a different description is marked unavailable', () => {
  const old = { label: 'Previous Output', electron: 'old-browser-id', mpv: 'alsa/hw:0' }
  const result = change('mpv', 'mpv', 'alsa/hw:0', old, [{ deviceId: 'alsa/hw:0', label: 'Other Hardware' }], [{ deviceId: 'alsa/hw:0', label: 'Other Hardware' }])
  assert.ok(result.deviceId.startsWith('unavailable:'))
  assert.equal(result.preference.label, 'Previous Output')
  assert.equal(getAudioDeviceForEngine(result.deviceId, result.preference, 'mpv'), result.deviceId)
})

test('native device reordering follows the preferred hardware instead of the old index', () => {
  const old = { label: 'Preferred Output', electron: 'browser-preferred', mpv: 'alsa/hw:0' }
  const result = change('mpv', 'electron', 'alsa/hw:0', old, [{ deviceId: 'alsa/hw:0', label: 'Other Output' }, { deviceId: 'alsa/hw:1', label: 'Preferred Output' }], [{ deviceId: 'browser-preferred', label: 'Preferred Output' }, { deviceId: 'browser-other', label: 'Other Output' }])
  assert.equal(result.deviceId, 'browser-preferred')
  assert.equal(result.preference.mpv, 'alsa/hw:1')
})

for (const nativeId of ['wasapi/{runtime-endpoint}', 'alsa/hw:CARD=Runtime,DEV=0', 'pulse/runtime-output', 'pipewire/runtime-node', 'coreaudio/runtime-uid', 'avfoundation/runtime-uid']) {
  test('device association is discovered from runtime catalogs for ' + nativeId.split('/')[0], () => {
    const browser = [{ deviceId: 'opaque-origin-scoped-id', label: 'Runtime Output' }]
    const native = [{ deviceId: nativeId, label: 'Runtime Output' }]
    const forward = change('electron', 'mpv', browser[0].deviceId, undefined, browser, native)
    assert.equal(forward.deviceId, nativeId)
    assert.equal(change('mpv', 'electron', nativeId, forward.preference, native, browser).deviceId, browser[0].deviceId)
  })
}

test('numeric backend IDs are not treated as stable identity when names are ambiguous', () => {
  const saved = { label: 'USB Output', electron: 'browser-a', mpv: 'alsa/hw:0' }
  const result = change('electron', 'mpv', 'browser-a', saved, [{ deviceId: 'browser-a', label: 'USB Output' }, { deviceId: 'browser-b', label: 'USB Output' }], [{ deviceId: 'alsa/hw:0', label: 'USB Output' }, { deviceId: 'alsa/hw:1', label: 'USB Output' }])
  assert.ok(result.deviceId.startsWith('unavailable:'))
})

test('equal full names take priority over metadata-normalized alternatives', () => {
  const result = change('electron', 'mpv', 'browser-literal', undefined, [{ deviceId: 'browser-literal', label: 'Output (Virtual)' }], [{ deviceId: 'native/short', label: 'Output' }, { deviceId: 'native/literal', label: 'Output (Virtual)' }])
  assert.equal(result.deviceId, 'native/literal')
})

test('embedded MPV video receives the mapped MPV ID rather than a Chromium ID', () => {
  const saved = change('electron', 'mpv', 'chromium-a').preference
  assert.equal(getAudioDeviceForEngine('chromium-a', saved, 'mpv'), 'avfoundation/duet')
  assert.equal(getAudioDeviceForEngine('avfoundation/duet', saved, 'electron'), 'chromium-a')
  assert.equal(getAudioDeviceForEngine('different-device', saved, 'mpv'), 'different-device')
})
