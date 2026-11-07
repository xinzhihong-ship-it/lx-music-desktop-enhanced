export const normalizeMpvAudioDevices = (rows: unknown[], isMac: boolean): Array<{ id: string, name: string }> => {
  const devices = new Map<string, { id: string, name: string }>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { name: id, description: name } = row as { name?: unknown, description?: unknown }
    if (typeof id !== 'string' || typeof name !== 'string' || !id || id === 'auto') continue
    // Names are not hardware identity: keep duplicate names with distinct IDs.
    const key = isMac ? id.replace(/^(coreaudio|avfoundation)\//, 'macos/') : id
    const existing = devices.get(key)
    if (!existing || (isMac && id.startsWith('avfoundation/') && !existing.id.startsWith('avfoundation/'))) devices.set(key, { id, name })
  }
  return [{ id: 'auto', name: '默认设备' }, ...devices.values()]
}

export const parseMpvAudioDevices = (output: string, isMac: boolean): Array<{ id: string, name: string }> => {
  const rows = output.split('\n').flatMap(line => {
    const match = line.match(/^\s*'([^']+)'\s*\((.*)\)\s*$/)
    return match ? [{ name: match[1], description: match[2] }] : []
  })
  return normalizeMpvAudioDevices(rows, isMac)
}
