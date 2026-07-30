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
