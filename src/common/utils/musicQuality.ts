type MusicQualityInfo = Pick<LX.Music.MusicInfoOnline['meta'], 'qualitys' | '_qualitys'>

// Merge platform metadata without removing known tiers or their hashes.
export const mergeMusicQuality = (current: MusicQualityInfo, incoming: MusicQualityInfo): MusicQualityInfo => {
  const qualitys = new Map(current.qualitys.map(item => [item.type, item]))
  for (const item of incoming.qualitys) {
    qualitys.set(item.type, { ...qualitys.get(item.type), ...item })
  }
  const _qualitys = { ...current._qualitys }
  for (const [type, info] of Object.entries(incoming._qualitys)) {
    if (!info) continue
    const quality = type as LX.Quality
    _qualitys[quality] = { ..._qualitys[quality], ...info }
  }
  return { qualitys: [...qualitys.values()], _qualitys }
}
