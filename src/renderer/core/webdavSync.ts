import { toRaw } from '@common/utils/vueTools'
import { getWebDAVFilePath, hashSyncData, decideWebDAVSync } from '@common/utils/webdavSync'
import { LIST_IDS } from '@common/constants'
import { filterMusicList, fixNewMusicInfoQuality } from '@renderer/utils'
import { getListMusics, overwriteListFull, reloadListData } from '@renderer/store/list/action'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { userApi } from '@renderer/store'
import { createExportSetting, preserveAgreement } from '@renderer/utils/exportSetting'
import { getUserApiData, overwriteUserApiData, sendWebDAVAction } from '@renderer/utils/ipc'
import { setUserApi } from '@renderer/core/apiSource'
import { dialog } from '@renderer/plugins/Dialog'

interface ListsFile {
  version: '2'
  lastModified: number
  data: LX.List.ListDataFull
}
interface SettingsFile {
  version: '2'
  lastModified: number
  data: Partial<LX.AppSetting>
}
interface UserApisFile {
  version: '2'
  lastModified: number
  data: LX.WebDAVSync.UserApiData
}

const syncLocks = new Set<symbol>()
let applyingRemote = false
let autoTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

const t = (key: string) => (window.i18n.t as unknown as (key: string) => string)(key)

const getConfig = (requireEnabled = true): LX.WebDAVSync.Config => {
  const config = {
    url: appSetting['sync.webdav.url'].trim(),
    username: appSetting['sync.webdav.username'],
    password: appSetting['sync.webdav.password'],
  }
  if ((requireEnabled && !appSetting['sync.webdav.enable']) || !config.url) throw new Error(t('setting__webdav_not_configured'))
  return config
}

const getPath = (fileName: string) => getWebDAVFilePath(appSetting['sync.webdav.path'] || '/LX_Music/', fileName)

const asRemoteFile = (result: LX.WebDAVSync.ServiceResult): LX.WebDAVSync.RemoteFile | null =>
  result && 'content' in result ? result : null

const download = async(fileName: string) => asRemoteFile(await sendWebDAVAction({
  action: 'download',
  data: { config: getConfig(), path: getPath(fileName) },
}))

const upload = async(fileName: string, data: unknown, options: { etag?: string, createOnly?: boolean } = {}) =>
  asRemoteFile(await sendWebDAVAction({
    action: 'upload',
    data: { config: getConfig(), path: getPath(fileName), content: JSON.stringify(data), ...options },
  }))

const getListData = async(): Promise<LX.List.ListDataFull> => ({
  defaultList: toRaw(await getListMusics(defaultList.id)),
  loveList: toRaw(await getListMusics(loveList.id)),
  tempList: toRaw(await getListMusics(LIST_IDS.TEMP)),
  userList: await Promise.all(userLists.map(async list => ({
    ...toRaw(list),
    list: toRaw(await getListMusics(list.id)),
  }))),
})

const normalizeMusicList = (list: unknown): LX.Music.MusicInfo[] => {
  if (!Array.isArray(list)) throw new Error(t('setting__webdav_invalid_data'))
  return filterMusicList(list).map(music => fixNewMusicInfoQuality(music))
}

const normalizeListData = (data: any): LX.List.ListDataFull => {
  if (!data || !Array.isArray(data.userList)) throw new Error(t('setting__webdav_invalid_data'))
  const ids = new Set<string>()
  const userList = data.userList.map((list: any) => {
    if (!list || typeof list.id != 'string' || !list.id || ids.has(list.id) || typeof list.name != 'string') throw new Error(t('setting__webdav_invalid_data'))
    ids.add(list.id)
    return {
      id: list.id,
      name: list.name,
      source: list.source,
      sourceListId: list.sourceListId,
      locationUpdateTime: list.locationUpdateTime ?? null,
      list: normalizeMusicList(list.list),
    }
  })
  return {
    defaultList: normalizeMusicList(data.defaultList),
    loveList: normalizeMusicList(data.loveList),
    tempList: normalizeMusicList(data.tempList ?? []),
    userList,
  }
}

const hasListData = (data: LX.List.ListDataFull) =>
  data.defaultList.length > 0 || data.loveList.length > 0 || data.tempList.length > 0 || data.userList.length > 0

const saveSyncState = (data: LX.List.ListDataFull, etag: string, lastModified = Date.now()) => {
  const setting = {
    'sync.webdav.lastListHash': hashSyncData(data),
    'sync.webdav.lastListEtag': etag,
    'sync.webdav.lastSyncTime': lastModified,
  }
  Object.assign(appSetting, setting)
  updateSetting(setting)
}

const createLocalBackup = async() => {
  const settings = createExportSetting(toRaw(appSetting))
  const lists = await getListData()
  const content = JSON.stringify({
    type: 'allData_v2',
    setting: settings,
    playList: [
      { ...toRaw(defaultList), list: lists.defaultList },
      { ...toRaw(loveList), list: lists.loveList },
      ...lists.userList,
    ],
    userApis: await getUserApiData(),
  })
  const result = await sendWebDAVAction({ action: 'backup', data: { content } })
  return result && 'backupPath' in result ? result.backupPath : ''
}

const applyListData = async(data: LX.List.ListDataFull, etag: string, lastModified: number) => {
  await createLocalBackup()
  applyingRemote = true
  try {
    await overwriteListFull(data)
    const ids = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP, ...data.userList.map(list => list.id)]
    await reloadListData(ids)
    window.app_event.myListUpdate(ids)
    saveSyncState(data, etag, lastModified)
  } finally {
    applyingRemote = false
  }
}

const uploadListData = async(data: LX.List.ListDataFull, options: { etag?: string, createOnly?: boolean } = {}) => {
  const document: ListsFile = { version: '2', lastModified: Date.now(), data }
  const result = await upload('playlists.json', document, options)
  saveSyncState(data, result?.etag ?? '', document.lastModified)
}

const parseListsFile = (remote: LX.WebDAVSync.RemoteFile): ListsFile => {
  const parsed = JSON.parse(remote.content)
  if (!parsed?.data) throw new Error(t('setting__webdav_invalid_data'))
  return { version: '2', lastModified: Number(parsed.lastModified) || Date.now(), data: normalizeListData(parsed.data) }
}

const confirmLocalOverwrite = () => dialog.confirm({
  message: t('setting__webdav_conflict_confirm'),
  cancelButtonText: t('setting__webdav_use_cloud'),
  confirmButtonText: t('setting__webdav_use_local'),
})

export const testWebDAVConnection = async() => {
  await sendWebDAVAction({ action: 'test', data: { config: getConfig(false) } })
}

export const syncWebDAVLists = async(manual = true) => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-sync')
  syncLocks.add(lock)
  try {
    const [localData, remote] = await Promise.all([getListData(), download('playlists.json')])
    if (!remote) {
      await uploadListData(localData, { createOnly: true })
      return 'upload'
    }

    const remoteFile = parseListsFile(remote)
    const localHash = hashSyncData(localData)
    const remoteHash = hashSyncData(remoteFile.data)
    let decision = decideWebDAVSync({
      hasRemote: true,
      hasLocalData: hasListData(localData),
      lastHash: appSetting['sync.webdav.lastListHash'],
      localHash,
      remoteHash,
    })

    if (decision == 'conflict') decision = await confirmLocalOverwrite() ? 'upload' : 'download'
    if (decision == 'upload') await uploadListData(localData, { etag: remote.etag })
    else if (decision == 'download') await applyListData(remoteFile.data, remote.etag, remoteFile.lastModified)
    else if (manual) saveSyncState(localData, remote.etag, remoteFile.lastModified)
    return decision
  } finally {
    syncLocks.delete(lock)
  }
}

export const uploadWebDAVLists = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-upload-lists')
  syncLocks.add(lock)
  try {
    await uploadListData(await getListData())
  } finally {
    syncLocks.delete(lock)
  }
}

export const downloadWebDAVLists = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-download-lists')
  syncLocks.add(lock)
  try {
    const remote = await download('playlists.json')
    if (!remote) throw new Error(t('setting__webdav_remote_missing'))
    const file = parseListsFile(remote)
    await applyListData(file.data, remote.etag, file.lastModified)
  } finally {
    syncLocks.delete(lock)
  }
}

const getCloudSettings = () => {
  const settings = createExportSetting(toRaw(appSetting)) as Partial<LX.AppSetting>
  delete settings['network.gitcodeMusicAccessToken']
  delete settings['sync.webdav.password']
  delete settings['sync.webdav.lastListEtag']
  delete settings['sync.webdav.lastListHash']
  delete settings['sync.webdav.lastSyncTime']
  return settings
}

export const uploadWebDAVSettings = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-upload-settings')
  syncLocks.add(lock)
  try {
    const timestamp = Date.now()
    const settings: SettingsFile = { version: '2', lastModified: timestamp, data: getCloudSettings() }
    const apis: UserApisFile = { version: '2', lastModified: timestamp, data: await getUserApiData() }
    await Promise.all([upload('settings.json', settings), upload('user_apis.json', apis)])
  } finally {
    syncLocks.delete(lock)
  }
}

export const downloadWebDAVSettings = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-download-settings')
  syncLocks.add(lock)
  try {
    const [settingsRemote, apisRemote] = await Promise.all([download('settings.json'), download('user_apis.json')])
    if (!settingsRemote && !apisRemote) throw new Error(t('setting__webdav_remote_missing'))
    await createLocalBackup()

    if (settingsRemote) {
      const parsed = JSON.parse(settingsRemote.content) as SettingsFile
      if (!parsed?.data || typeof parsed.data != 'object') throw new Error(t('setting__webdav_invalid_data'))
      const protectedKeys = new Set([
        'common.isAgreePact',
        'network.gitcodeMusicAccessToken',
        'sync.webdav.password',
        'sync.webdav.enable',
        'sync.webdav.autoSync',
        'sync.webdav.url',
        'sync.webdav.username',
        'sync.webdav.path',
        'sync.webdav.lastListEtag',
        'sync.webdav.lastListHash',
        'sync.webdav.lastSyncTime',
      ])
      const setting = preserveAgreement(
        Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key in appSetting && !protectedKeys.has(key))) as Partial<LX.AppSetting>,
        appSetting['common.isAgreePact'],
      )
      Object.assign(appSetting, setting)
      updateSetting(setting)
    }

    if (apisRemote) {
      const parsed = JSON.parse(apisRemote.content) as UserApisFile
      if (!parsed?.data) throw new Error(t('setting__webdav_invalid_data'))
      userApi.list = await overwriteUserApiData(parsed.data)
      if (userApi.list.some(api => api.id == appSetting['common.apiSource'])) await setUserApi(appSetting['common.apiSource'])
    }
  } finally {
    syncLocks.delete(lock)
  }
}

const scheduleAutoSync = () => {
  if (applyingRemote || !appSetting['sync.webdav.enable'] || !appSetting['sync.webdav.autoSync']) return
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    void syncWebDAVLists(false).catch(error => {
      void dialog({ message: `${t('setting__webdav_sync_failed')}: ${error?.message ?? String(error)}` })
    })
  }, 3000)
}

export const initWebDAVSync = () => {
  if (initialized) return
  initialized = true
  window.app_event.on('myListUpdate', scheduleAutoSync)
  window.app_event.on('focus', () => {
    if (appSetting['sync.webdav.enable'] && appSetting['sync.webdav.autoSync']) void syncWebDAVLists(false).catch(() => {})
  })
  if (appSetting['sync.webdav.enable'] && appSetting['sync.webdav.autoSync']) {
    void syncWebDAVLists(false).catch(() => {})
  }
}
