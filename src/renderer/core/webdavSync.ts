import { ref, toRaw } from '@common/utils/vueTools'
import { getWebDAVFilePath, hashSyncData, decideWebDAVSync, getWebDAVUploadSettings, pickWebDAVDownloadSettings } from '@common/utils/webdavSync'
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
import { setAllStatus } from '@renderer/store/player/action'
import { statusText } from '@renderer/store/player/state'

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

    if (decision == 'conflict') {
      // 自动同步遇到冲突：不弹确认框，保留本地版本——既不下载覆盖本地，也不上传覆盖云端（避免静默
      // 丢掉另一台设备的修改）；同步基线保持不变，冲突会持续存在，直到用户手动同步并选择
      if (!manual) return 'conflict'
      decision = await confirmLocalOverwrite() ? 'upload' : 'download'
    }
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

// 不上传敏感信息、同步状态与平台专属设置（引擎、mpv 路径、输出设备、下载目录）
const getCloudSettings = () => getWebDAVUploadSettings(createExportSetting(toRaw(appSetting))) as Partial<LX.AppSetting>

export const uploadWebDAVSettings = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-upload-settings')
  syncLocks.add(lock)
  try {
    const settings: SettingsFile = { version: '2', lastModified: Date.now(), data: getCloudSettings() }
    await upload('settings.json', settings)
  } finally {
    syncLocks.delete(lock)
  }
}

export const uploadWebDAVUserApis = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-upload-user-apis')
  syncLocks.add(lock)
  try {
    const apis: UserApisFile = { version: '2', lastModified: Date.now(), data: await getUserApiData() }
    await upload('user_apis.json', apis)
  } finally {
    syncLocks.delete(lock)
  }
}

export const downloadWebDAVSettings = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-download-settings')
  syncLocks.add(lock)
  try {
    const settingsRemote = await download('settings.json')
    if (!settingsRemote) throw new Error(t('setting__webdav_remote_missing'))
    await createLocalBackup()

    const parsed = JSON.parse(settingsRemote.content) as SettingsFile
    if (!parsed?.data || typeof parsed.data != 'object') throw new Error(t('setting__webdav_invalid_data'))
    // 受保护键（协议、WebDAV 连接配置、同步状态）与平台专属设置不覆盖本地
    const setting = preserveAgreement(
      pickWebDAVDownloadSettings(parsed.data as Record<string, unknown>, appSetting) as Partial<LX.AppSetting>,
      appSetting['common.isAgreePact'],
    )
    Object.assign(appSetting, setting)
    updateSetting(setting)
  } finally {
    syncLocks.delete(lock)
  }
}

export const downloadWebDAVUserApis = async() => {
  if (syncLocks.size) throw new Error(t('setting__webdav_syncing'))
  const lock = Symbol('webdav-download-user-apis')
  syncLocks.add(lock)
  try {
    const apisRemote = await download('user_apis.json')
    if (!apisRemote) throw new Error(t('setting__webdav_remote_missing'))
    await createLocalBackup()

    const parsed = JSON.parse(apisRemote.content) as UserApisFile
    if (!parsed?.data) throw new Error(t('setting__webdav_invalid_data'))
    userApi.list = await overwriteUserApiData(parsed.data)
    if (userApi.list.some(api => api.id == appSetting['common.apiSource'])) await setUserApi(appSetting['common.apiSource'])
  } finally {
    syncLocks.delete(lock)
  }
}

// ---- 自动同步：后台静默执行，问题只在状态栏提示，不弹阻塞对话框 ----

export interface WebDAVAutoSyncNotice {
  type: 'failed' | 'conflict'
  message: string
  time: number
}
/** 自动同步最近一次的问题，在 WebDAV 设置中持续展示；同步成功后清空 */
export const webdavAutoSyncNotice = ref<WebDAVAutoSyncNotice | null>(null)

/** 同一类问题连续出现时，状态栏最多每 5 分钟提示一次（断网时每次歌单变更 / 窗口获焦都会触发同步） */
const STATUS_NOTICE_INTERVAL = 5 * 60_000
const STATUS_NOTICE_DURATION = 8000
const lastStatusNoticeAt = new Map<WebDAVAutoSyncNotice['type'], number>()

const tp = (key: string, params: Record<string, string>) => (window.i18n.t as unknown as (key: string, params: Record<string, string>) => string)(key, params)

const reportAutoSyncProblem = (type: WebDAVAutoSyncNotice['type'], message: string) => {
  const now = Date.now()
  webdavAutoSyncNotice.value = { type, message, time: now }
  if (now - (lastStatusNoticeAt.get(type) ?? 0) < STATUS_NOTICE_INTERVAL) return
  lastStatusNoticeAt.set(type, now)
  setAllStatus(message)
  setTimeout(() => { if (statusText.value == message) setAllStatus('') }, STATUS_NOTICE_DURATION)
}

/** 执行一次自动同步（歌单变更防抖后、窗口获焦、启动时）。失败不抛出、不弹窗。 */
export const runWebDAVAutoSync = async() => {
  if (applyingRemote || !appSetting['sync.webdav.enable'] || !appSetting['sync.webdav.autoSync']) return
  try {
    const decision = await syncWebDAVLists(false)
    if (decision == 'conflict') {
      reportAutoSyncProblem('conflict', t('setting__webdav_auto_sync_conflict_status'))
      return
    }
    // 成功：结束本轮问题，之后再出问题重新提示
    lastStatusNoticeAt.clear()
    webdavAutoSyncNotice.value = null
  } catch (error: any) {
    const message = error?.message ?? String(error)
    // 与手动同步或另一次自动触发重叠：不是失败，静默跳过
    if (message == t('setting__webdav_syncing')) return
    reportAutoSyncProblem('failed', tp('setting__webdav_auto_sync_failed_status', { message }))
  }
}

const scheduleAutoSync = () => {
  if (applyingRemote || !appSetting['sync.webdav.enable'] || !appSetting['sync.webdav.autoSync']) return
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    void runWebDAVAutoSync()
  }, 3000)
}

export const initWebDAVSync = () => {
  if (initialized) return
  initialized = true
  window.app_event.on('myListUpdate', scheduleAutoSync)
  window.app_event.on('focus', () => { void runWebDAVAutoSync() })
  void runWebDAVAutoSync()
}
