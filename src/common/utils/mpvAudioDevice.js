export const AVFOUNDATION_DEVICE_PREFIX = 'avfoundation/'
export const COREAUDIO_DEVICE_PREFIX = 'coreaudio/'

/**
 * macOS 上 mpv 会同时枚举 coreaudio 与 avfoundation 两套驱动，设备列表按名称去重后
 * 应用保存的是 avfoundation 前缀的 id（见 mpvController.listAudioDevices）。
 *
 * 但 avfoundation 这个 AO（AVSampleBufferAudioRenderer）会把约 2 秒的音频提前排在队列里，
 * 而 mpv 的音量/静音是在数据进入该队列之前施加的软件增益 —— 于是静音/取消静音要等
 * 队列放完才生效（暂停、seek、切歌不受影响，它们会 flush）。
 * coreaudio 是 mpv 在 macOS 的默认驱动，是拉模式、缓冲只有 --audio-buffer（默认 0.2s），
 * 因此这里在交给 mpv 之前把驱动前缀换成 coreaudio。
 *
 * 对 coreaudio 打不开的设备（实测：部分 USB 声卡、聚合设备会报
 * "unable to set the input channel layout on the audio unit"），运行时检测到
 * 初始化失败后会把该设备记进 fallbackDevices，之后一直沿用原来的 avfoundation id，
 * 保证「选了这台设备就一定有声」。
 *
 * @param {string} deviceId 应用中保存的设备 id（可能是 avfoundation/xxx）
 * @param {{ isMacPlatform?: boolean, fallbackDevices?: string[] }} [options]
 * @returns {string} 实际传给 mpv --audio-device 的 id
 */
export const resolveMpvAudioDevice = (deviceId, options = {}) => {
  const { isMacPlatform = false, fallbackDevices = [] } = options
  if (typeof deviceId !== 'string' || !deviceId) return deviceId
  if (!isMacPlatform) return deviceId
  if (!deviceId.startsWith(AVFOUNDATION_DEVICE_PREFIX)) return deviceId
  if (Array.isArray(fallbackDevices) && fallbackDevices.includes(deviceId)) return deviceId
  return COREAUDIO_DEVICE_PREFIX + deviceId.slice(AVFOUNDATION_DEVICE_PREFIX.length)
}

/**
 * 该设备是否会被映射成 coreaudio（用于判断 AO 初始化失败时要不要记入回退名单：
 * 只有被映射过的设备才值得记，否则会污染名单）。
 */
export const isCoreAudioMappedDevice = (deviceId, options = {}) => {
  return (
    typeof deviceId === 'string' &&
    deviceId.startsWith(AVFOUNDATION_DEVICE_PREFIX) &&
    resolveMpvAudioDevice(deviceId, options) !== deviceId
  )
}
