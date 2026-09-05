export const filterMusicRows = <T>(
  list: T[],
  text: string,
  getInfo: (item: T) => { name?: string, singer?: string, meta?: { albumName?: string } } = item => item as any,
) => {
  const query = text.trim().toLocaleLowerCase()
  return list.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (!query) return true
    const info = getInfo(item)
    return [info.name, info.singer, info.meta?.albumName]
      .some(value => value?.toLocaleLowerCase().includes(query))
  })
}

const variantRxp = /[（(][^）)]*[）)]/g
const normalizeRxp = /[\s'.,，&"、()（）`~\-<>|/[\]]/g
const singerSplitRxp = /、|&|;|；|\/|,|，|\|/

export const filterDuplicateMusicRows = <T extends { id?: string, name: string, singer?: string }>(
  list: T[],
  isFilterVariant = true,
) => {
  const groups = new Map<string, Array<{ id?: string, index: number, musicInfo: T }>>()
  const duplicateKeys = new Set<string>()
  const normalize = (text: string) => text.toLocaleLowerCase().replace(normalizeRxp, '')

  list.forEach((musicInfo, index) => {
    let name = isFilterVariant ? normalize(musicInfo.name.replace(variantRxp, '')) : musicInfo.name.toLocaleLowerCase().trim()
    name ||= normalize(musicInfo.name)
    const singers = [...new Set((musicInfo.singer ?? '').split(singerSplitRxp).map(normalize).filter(Boolean))]

    for (const singer of singers.length ? singers : ['']) {
      const key = `${name}\0${singer}`
      const group = groups.get(key)
      const item = { id: musicInfo.id, index, musicInfo }
      if (group) {
        group.push(item)
        duplicateKeys.add(key)
      } else {
        groups.set(key, [item])
      }
    }
  })

  const indexes = new Set<number>()
  return [...duplicateKeys].sort((a, b) => a.localeCompare(b))
    .flatMap(key => groups.get(key)!)
    .filter(item => {
      if (indexes.has(item.index)) return false
      indexes.add(item.index)
      return true
    })
}
