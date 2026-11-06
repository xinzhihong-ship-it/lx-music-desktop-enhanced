/**
 * 移动端兼容层。
 *
 * 移动端没有 B 站解析能力，B 站歌曲（source === 'bili'）与 B 站来源歌单只保留在桌面端：
 * - 下发给移动端（desktop → mobile）：过滤 B 站内容，并把基于完整列表计算的位置换算成
 *   移动端可见列表里的位置，保证两端可见部分顺序一致。
 * - 接收移动端（mobile → desktop）：移动端的覆盖 / 清空 / 全量数据看不到 B 站内容，
 *   应用前把本地 B 站内容按原相对位置合并回去；位置类操作换算回完整列表的位置。
 */

type MusicInfo = LX.Music.MusicInfo
type UserListInfo = LX.List.UserListInfo
type ListAction = LX.Sync.List.ActionList

export const isDesktopOnlyMusic = (musicInfo: Pick<MusicInfo, 'source'>) => musicInfo.source === 'bili'
export const isDesktopOnlyList = (list: Pick<UserListInfo, 'source'>) => list.source === 'bili'

const filterMusicInfos = <T extends MusicInfo>(musicInfos: T[]): T[] =>
  musicInfos.filter(musicInfo => !isDesktopOnlyMusic(musicInfo))

/** 读取本地列表数据；默认读主进程数据库，测试时可替换。 */
export interface LocalListReader {
  getListMusics: (listId: string) => Promise<MusicInfo[]>
  getUserLists: () => Promise<UserListInfo[]>
  getListData: () => Promise<LX.Sync.List.ListData>
}

const defaultReader: LocalListReader = {
  getListMusics: async listId => global.lx.worker.dbService.getListMusics(listId),
  getUserLists: async() => global.lx.worker.dbService.getAllUserList(),
  // 与 listEvent.getLocalListData 相同；不直接引用它，保持本模块无别名依赖、可被测试直接加载
  getListData: async() => {
    const dbService = global.lx.worker.dbService
    const userList: LX.List.UserListInfoFull[] = []
    for (const list of await dbService.getAllUserList()) {
      userList.push({ ...list, list: await dbService.getListMusics(list.id) })
    }
    return {
      defaultList: await dbService.getListMusics('default'),
      loveList: await dbService.getListMusics('love'),
      userList,
    }
  },
}

// ---------------------------------------------------------------------------
// 纯函数：位置换算与隐藏项恢复
// ---------------------------------------------------------------------------

const HEAD = Symbol('head')

/**
 * 把 local 中被隐藏、且不在 result 里的条目按原相对位置插回 result。
 * 每个隐藏条目挂在它前面最近一个「仍存在于 result 中」的条目之后；前面没有则放在最前。
 * 已存在于 result 的条目不会重复插入。
 */
export const restoreHiddenItems = <T extends { id: string }>(
  localItems: readonly T[],
  resultItems: readonly T[],
  isHidden: (item: T) => boolean,
): T[] => {
  const resultIds = new Set(resultItems.map(item => item.id))
  const inserts = new Map<string | typeof HEAD, T[]>()
  let anchor: string | typeof HEAD = HEAD
  let restored = 0
  for (const item of localItems) {
    if (resultIds.has(item.id)) {
      anchor = item.id
      continue
    }
    if (!isHidden(item)) continue
    const group = inserts.get(anchor)
    if (group) group.push(item)
    else inserts.set(anchor, [item])
    restored++
  }
  if (!restored) return [...resultItems]
  const output: T[] = [...(inserts.get(HEAD) ?? [])]
  for (const item of resultItems) {
    output.push(item)
    const group = inserts.get(item.id)
    if (group) output.push(...group)
  }
  return output
}

/** 把移动端回传的列表数据与本地数据合并：保留本地所有 B 站歌曲与 B 站来源歌单。 */
export const restoreDesktopOnlyListData = <T extends LX.Sync.List.ListData | LX.List.ListActionDataOverwrite>(
  result: T,
  local: LX.Sync.List.ListData,
): T => {
  const localUserLists = new Map(local.userList.map(list => [list.id, list]))
  const userList = result.userList.map(list => {
    const localList = localUserLists.get(list.id)
    return localList
      ? { ...list, list: restoreHiddenItems(localList.list, list.list, isDesktopOnlyMusic) }
      : list
  })
  return Object.assign({}, result, {
    defaultList: restoreHiddenItems(local.defaultList, result.defaultList, isDesktopOnlyMusic),
    loveList: restoreHiddenItems(local.loveList, result.loveList, isDesktopOnlyMusic),
    userList: restoreHiddenItems(local.userList, userList, isDesktopOnlyList),
  })
}

/**
 * 「移出 ids 后插到 position」类操作：移动端位置 → 桌面端位置。
 * 移动端的 position 是移出 ids 后可见列表里的下标，这里换算成桌面端完整列表（同样移出 ids）里的下标：
 * 插在原本位于该可见位置的条目之前；超出可见末尾时插在最后一个可见条目之后。
 */
export const mapMovePositionToDesktop = <T extends { id: string }>(
  fullItems: readonly T[],
  ids: readonly string[],
  position: number,
  isHidden: (item: T) => boolean,
): number => {
  if (position < 0) return position
  const idSet = new Set(ids)
  const remaining = fullItems.filter(item => !idSet.has(item.id))
  const visibleIndexes: number[] = []
  remaining.forEach((item, index) => { if (!isHidden(item)) visibleIndexes.push(index) })
  if (position < visibleIndexes.length) return visibleIndexes[position]
  return visibleIndexes.length ? visibleIndexes[visibleIndexes.length - 1] + 1 : remaining.length
}

/** 「移出 ids 后插到 position」类操作：桌面端位置 → 移动端位置（统计目标位置前的可见条目数）。 */
export const mapMovePositionToMobile = <T extends { id: string }>(
  fullItems: readonly T[],
  ids: readonly string[],
  position: number,
  isHidden: (item: T) => boolean,
): number => {
  if (position < 0) return position
  const idSet = new Set(ids)
  const remaining = fullItems.filter(item => !idSet.has(item.id))
  return remaining.slice(0, position).filter(item => !isHidden(item)).length
}

/** 新建歌单的插入位置：移动端 → 桌面端。preLists 为创建前的桌面端歌单。 */
export const mapCreatePositionToDesktop = (preLists: readonly UserListInfo[], position: number): number => {
  if (position < 0) return position
  const visibleIndexes: number[] = []
  preLists.forEach((list, index) => { if (!isDesktopOnlyList(list)) visibleIndexes.push(index) })
  // 移动端追加到末尾时桌面端同样追加到末尾
  return position < visibleIndexes.length ? visibleIndexes[position] : preLists.length
}

/** 新建歌单的插入位置：桌面端 → 移动端。preLists 为创建前的桌面端歌单。 */
export const mapCreatePositionToMobile = (preLists: readonly UserListInfo[], position: number): number => {
  if (position < 0 || position >= preLists.length) return position
  return preLists.slice(0, position).filter(list => !isDesktopOnlyList(list)).length
}

// ---------------------------------------------------------------------------
// desktop → mobile
// ---------------------------------------------------------------------------

export const filterListDataForMobile = <T extends MakeOptional<LX.List.ListDataFull, 'tempList'>>(listData: T): T => {
  const filteredListData = {
    ...listData,
    defaultList: filterMusicInfos(listData.defaultList),
    loveList: filterMusicInfos(listData.loveList),
    userList: listData.userList
      .filter(list => !isDesktopOnlyList(list))
      .map(list => ({
        ...list,
        list: filterMusicInfos(list.list),
      })),
  }
  if (listData.tempList) filteredListData.tempList = filterMusicInfos(listData.tempList)
  return filteredListData as T
}

/**
 * 把本地（桌面端视角）的列表操作转换成发给移动端的操作；返回 null 表示该操作对移动端无可见影响。
 * 位置换算读取的是本地当前列表，操作执行前后读取结果一致（换算只依赖「移出 ids 后」的列表）。
 */
export const toMobileListAction = async(
  action: ListAction,
  reader: LocalListReader = defaultReader,
): Promise<ListAction | null> => {
  switch (action.action) {
    case 'list_data_overwrite':
      return { ...action, data: filterListDataForMobile(action.data) }
    case 'list_create': {
      const listInfos = action.data.listInfos.filter(list => !isDesktopOnlyList(list))
      if (!listInfos.length) return null
      const createdIds = new Set(action.data.listInfos.map(list => list.id))
      const preLists = (await reader.getUserLists()).filter(list => !createdIds.has(list.id))
      return { ...action, data: { listInfos, position: mapCreatePositionToMobile(preLists, action.data.position) } }
    }
    case 'list_update': {
      const listInfos = action.data.filter(list => !isDesktopOnlyList(list))
      return listInfos.length ? { ...action, data: listInfos } : null
    }
    case 'list_update_position': {
      const lists = await reader.getUserLists()
      const hiddenIds = new Set(lists.filter(isDesktopOnlyList).map(list => list.id))
      const ids = action.data.ids.filter(id => !hiddenIds.has(id))
      if (!ids.length) return null
      return { ...action, data: { ids, position: mapMovePositionToMobile(lists, action.data.ids, action.data.position, isDesktopOnlyList) } }
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
      const musicInfos = action.data.filter(item => !isDesktopOnlyMusic(item.musicInfo))
      return musicInfos.length ? { ...action, data: musicInfos } : null
    }
    case 'list_music_update_position': {
      const list = await reader.getListMusics(action.data.listId)
      const hiddenIds = new Set(list.filter(isDesktopOnlyMusic).map(musicInfo => musicInfo.id))
      const ids = action.data.ids.filter(id => !hiddenIds.has(id))
      if (!ids.length) return null
      return {
        ...action,
        data: { ...action.data, ids, position: mapMovePositionToMobile(list, action.data.ids, action.data.position, isDesktopOnlyMusic) },
      }
    }
    case 'list_music_overwrite':
      // 列表只剩 B 站歌曲时也要下发（空列表），否则移动端会残留已被覆盖掉的旧歌曲
      return { ...action, data: { ...action.data, musicInfos: filterMusicInfos(action.data.musicInfos) } }
    default:
      // list_remove / list_music_remove / list_music_clear：只含 id，移动端忽略不存在的 id
      return action
  }
}

// ---------------------------------------------------------------------------
// mobile → desktop
// ---------------------------------------------------------------------------

/**
 * 把移动端发来的操作转换成可在桌面端安全执行的操作（可能拆成多条）。
 * 必须在操作应用到本地之前调用：需要读取应用前的本地列表。
 */
export const adaptMobileListAction = async(
  action: ListAction,
  reader: LocalListReader = defaultReader,
): Promise<ListAction[]> => {
  switch (action.action) {
    case 'list_data_overwrite':
      return [{ ...action, data: restoreDesktopOnlyListData(action.data, await reader.getListData()) }]
    case 'list_music_overwrite': {
      const local = await reader.getListMusics(action.data.listId)
      return [{ ...action, data: { ...action.data, musicInfos: restoreHiddenItems(local, action.data.musicInfos, isDesktopOnlyMusic) } }]
    }
    case 'list_music_clear': {
      // 清空只作用于移动端可见的歌曲：含 B 站歌曲的列表改为「覆盖成仅剩 B 站歌曲」
      const clearIds: string[] = []
      const overwrites: ListAction[] = []
      for (const listId of action.data) {
        const biliMusics = (await reader.getListMusics(listId)).filter(isDesktopOnlyMusic)
        if (biliMusics.length) overwrites.push({ action: 'list_music_overwrite', data: { listId, musicInfos: biliMusics } })
        else clearIds.push(listId)
      }
      return [...(clearIds.length ? [{ ...action, data: clearIds }] : []), ...overwrites]
    }
    case 'list_music_update_position': {
      const list = await reader.getListMusics(action.data.listId)
      return [{ ...action, data: { ...action.data, position: mapMovePositionToDesktop(list, action.data.ids, action.data.position, isDesktopOnlyMusic) } }]
    }
    case 'list_update_position': {
      const lists = await reader.getUserLists()
      return [{ ...action, data: { ...action.data, position: mapMovePositionToDesktop(lists, action.data.ids, action.data.position, isDesktopOnlyList) } }]
    }
    case 'list_create': {
      const lists = await reader.getUserLists()
      return [{ ...action, data: { ...action.data, position: mapCreatePositionToDesktop(lists, action.data.position) } }]
    }
    default:
      return [action]
  }
}
