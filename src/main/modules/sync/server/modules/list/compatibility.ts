// Mobile LX Music has no Bilibili resolver; keep those entries on desktop only.
const filterMusicInfos = <T extends LX.Music.MusicInfo>(musicInfos: T[]): T[] =>
  musicInfos.filter(musicInfo => musicInfo.source !== 'bili')

export const filterListDataForMobile = (
  listData: MakeOptional<LX.List.ListDataFull, 'tempList'>,
): MakeOptional<LX.List.ListDataFull, 'tempList'> => {
  const filteredListData = {
    ...listData,
    defaultList: filterMusicInfos(listData.defaultList),
    loveList: filterMusicInfos(listData.loveList),
    userList: listData.userList
      .filter(list => list.source !== 'bili')
      .map(list => ({
        ...list,
        list: filterMusicInfos(list.list),
      })),
  }
  if (listData.tempList) filteredListData.tempList = filterMusicInfos(listData.tempList)
  return filteredListData
}

export const filterListActionForMobile = (
  action: LX.Sync.List.ActionList,
): LX.Sync.List.ActionList | null => {
  switch (action.action) {
    case 'list_data_overwrite':
      return { ...action, data: filterListDataForMobile(action.data) }
    case 'list_create': {
      const listInfos = action.data.listInfos.filter(list => list.source !== 'bili')
      return listInfos.length ? { ...action, data: { ...action.data, listInfos } } : null
    }
    case 'list_update': {
      const listInfos = action.data.filter(list => list.source !== 'bili')
      return listInfos.length ? { ...action, data: listInfos } : null
    }
    case 'list_music_add': {
      const musicInfos = filterMusicInfos(action.data.musicInfos)
      return musicInfos.length ? { ...action, data: { ...action.data, musicInfos } } : null
    }
    case 'list_music_move': {
      const musicInfos = filterMusicInfos(action.data.musicInfos)
      return musicInfos.length ? { ...action, data: { ...action.data, musicInfos } } : null
    }
    case 'list_music_update': {
      const musicInfos = action.data.filter(item => item.musicInfo.source !== 'bili')
      return musicInfos.length ? { ...action, data: musicInfos } : null
    }
    case 'list_music_overwrite': {
      const musicInfos = filterMusicInfos(action.data.musicInfos)
      return musicInfos.length ? { ...action, data: { ...action.data, musicInfos } } : null
    }
    default:
      return action
  }
}
