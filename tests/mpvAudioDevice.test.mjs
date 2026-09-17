import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AVFOUNDATION_DEVICE_PREFIX,
  COREAUDIO_DEVICE_PREFIX,
  isCoreAudioMappedDevice,
  resolveMpvAudioDevice,
} from '../src/common/utils/mpvAudioDevice.js'

const LOOPBACK = 'com.rogueamoeba.Loopback::F98F0164-3769-4E57-A450-67A569CABEE4'
const AVF_BANZOU = AVFOUNDATION_DEVICE_PREFIX + LOOPBACK
const CORE_BANZOU = COREAUDIO_DEVICE_PREFIX + LOOPBACK

test('非 macOS 平台不改写设备 id', () => {
  assert.equal(resolveMpvAudioDevice(AVF_BANZOU), AVF_BANZOU)
  assert.equal(resolveMpvAudioDevice(AVF_BANZOU, { isMacPlatform: false }), AVF_BANZOU)
})

test('macOS 上把 avfoundation 前缀换成 mpv 默认的 coreaudio（同后缀）', () => {
  assert.equal(resolveMpvAudioDevice(AVF_BANZOU, { isMacPlatform: true }), CORE_BANZOU)
  assert.equal(
    resolveMpvAudioDevice('avfoundation/BuiltInSpeakerDevice', { isMacPlatform: true }),
    'coreaudio/BuiltInSpeakerDevice',
  )
})

test('回退名单里的设备保持 avfoundation（coreaudio 打不开的硬件设备）', () => {
  const options = { isMacPlatform: true, fallbackDevices: [AVF_BANZOU] }
  assert.equal(resolveMpvAudioDevice(AVF_BANZOU, options), AVF_BANZOU)
  // 名单只影响命中的设备
  assert.equal(
    resolveMpvAudioDevice('avfoundation/BuiltInSpeakerDevice', options),
    'coreaudio/BuiltInSpeakerDevice',
  )
})

test('coreaudio 前缀、auto/默认值、空值都原样返回', () => {
  const options = { isMacPlatform: true }
  assert.equal(resolveMpvAudioDevice(CORE_BANZOU, options), CORE_BANZOU)
  assert.equal(resolveMpvAudioDevice('auto', options), 'auto')
  assert.equal(resolveMpvAudioDevice('', options), '')
  assert.equal(resolveMpvAudioDevice(undefined, options), undefined)
})

test('只有会被映射成 coreaudio 的设备才算「映射过」', () => {
  const options = { isMacPlatform: true }
  assert.equal(isCoreAudioMappedDevice(AVF_BANZOU, options), true)
  assert.equal(isCoreAudioMappedDevice(CORE_BANZOU, options), false)
  assert.equal(isCoreAudioMappedDevice('auto', options), false)
  assert.equal(
    isCoreAudioMappedDevice(AVF_BANZOU, { isMacPlatform: true, fallbackDevices: [AVF_BANZOU] }),
    false,
  )
})
