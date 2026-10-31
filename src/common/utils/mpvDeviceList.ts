export const parseMpvAudioDevices = (output: string, isMac: boolean): Array<{ id: string, name: string }> => {
  const devices = new Map<string, { id: string, name: string }>()
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*'([^']+)'\s*\((.*)\)\s*$/)
    if (!match || match[1] === 'auto') continue
    const [, id, name] = match
    // Names are not hardware identity: keep duplicate names with distinct IDs.
    const key = isMac ? id.replace(/^(coreaudio|avfoundation)\//, 'macos/') : id
    const existing = devices.get(key)
    if (!existing || (isMac && id.startsWith('avfoundation/') && !existing.id.startsWith('avfoundation/'))) devices.set(key, { id, name })
  }
  return [{ id: 'auto', name: '默认设备' }, ...devices.values()]
}
