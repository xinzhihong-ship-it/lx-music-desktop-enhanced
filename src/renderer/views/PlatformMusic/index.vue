<template>
  <div :class="$style.container">
    <aside :class="$style.lists">
      <div :class="$style.header">
        <h2>{{ $t('account__platform_music') }}</h2>
        <button :class="$style.refresh" :aria-label="$t('account__playlist_refresh')" :disabled="isRefreshing" @click="refreshPlatformMusic">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
            <use xlink:href="#icon-refresh" />
          </svg>
        </button>
      </div>
      <base-selection
        v-if="accountOptions.length > 1"
        :class="$style.accountSelect"
        :model-value="selectedAccountId"
        :list="accountOptions"
        item-key="id"
        item-name="name"
        @update:model-value="handleAccountChange"
      />
      <div class="scroll" :class="$style.accountGroups">
        <section v-for="group in visibleGroups" :key="group.account.id" :class="$style.group">
          <div :class="$style.account">
            <img v-if="group.account.avatar" :src="group.account.avatar">
            <span>
              <strong>{{ sourceName(group.account.source) }}</strong>
              <small>{{ group.account.nickname }}</small>
            </span>
          </div>
          <button
            v-if="group.account.source !== 'bili'"
            :class="[$style.item, { [$style.active]: selectedKey === `${group.account.id}:daily` }]"
            @click="selectDaily(group.account)"
          >
            {{ $t('account__playlist_tab_daily') }}
          </button>
          <button
            v-for="playlist in group.playlists"
            :key="playlist.id"
            :class="[$style.item, { [$style.active]: selectedKey === `${group.account.id}:${playlist.id}` }]"
            :title="playlist.name"
            @click="selectPlaylist(group.account, playlist)"
          >
            {{ playlist.name }}
          </button>
          <p v-if="group.error" :class="$style.error">{{ group.error }}</p>
        </section>
        <p v-if="!groups.length" :class="$style.empty">{{ $t('account__platform_music_empty') }}</p>
      </div>
    </aside>
    <main :class="$style.content">
      <div :class="$style.listHeader">
        <div :class="$style.headerInfo">
          <h3>{{ selectedTitle || $t('account__platform_music_select') }}</h3>
          <p v-if="selectedSource">{{ sourceName(selectedSource) }}</p>
          <p v-if="error" :class="$style.loadError">{{ error }}</p>
        </div>
        <input ref="filterInput" v-model="filterText" :class="$style.filterInput" type="search" :placeholder="$t('list__search')">
        <base-btn v-if="songs.length" outline @click="playSongs(0)">{{ $t('list__play') }}</base-btn>
      </div>
      <div :class="$style.songList">
        <material-online-list
          ref="listRef"
          :page="1"
          :limit="Math.max(filteredSongs.length, 1)"
          :total="filteredSongs.length"
          :list="filteredSongs"
          :no-item="statusText"
          :allow-platform-remove="Boolean(selectedDestination?.playlist.isEditable)"
          @play-list="playFilteredSongs"
          @remove-from-platform="handleRemoveFromPlatform"
        />
      </div>
    </main>
    <search-list :list="songs" :visible="isShowLocator" @action="handleLocatorAction" />
  </div>
</template>

<script setup lang="ts">
import { computed, markRawList, nextTick, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { playList } from '@renderer/core/player'
import { setTempList } from '@renderer/store/list/action'
import {
  accounts,
  loadAccounts,
  platformPlaylistRevision,
  removeFromPlatformPlaylist,
  type PlatformPlaylistDestination,
} from '@renderer/store/account'
import { getAccountDailyTrackIds, getAccountPlaylists, getAccountPlaylistTrackIds } from '@renderer/utils/ipc'
import { toNewMusicInfo } from '@renderer/utils'
import { getMusicInfos as getKgMusicInfos } from '@renderer/utils/musicSdk/kg/musicInfo'
import { getMusicInfos as getBiliMusicInfos } from '@renderer/utils/musicSdk/bili/musicInfo'
import txMusicInfo from '@renderer/utils/musicSdk/tx/musicInfo'
import wyMusicDetail from '@renderer/utils/musicSdk/wy/musicDetail'
import { dialog } from '@renderer/plugins/Dialog'
import SearchList from '@renderer/views/List/MusicList/components/SearchList.vue'
import { filterMusicRows } from '@renderer/utils/filterMusicRows'

interface AccountGroup {
  account: LX.Account.PlatformAccount
  playlists: LX.Account.PlaylistInfo[]
  error: string
}

const groups = ref<AccountGroup[]>([])
const selectedAccountId = ref('')
const songs = ref<LX.Music.MusicInfoOnline[]>([])
const selectedKey = ref('')
const selectedTitle = ref('')
const selectedSource = ref<LX.Account.Source | ''>('')
const selectedDestination = ref<PlatformPlaylistDestination | null>(null)
const isLoading = ref(false)
const isRefreshing = ref(false)
const error = ref('')
const listRef = ref<any>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const filterText = ref('')
const isShowLocator = ref(false)
let playlistLoadSequence = 0
let selectionLoadSequence = 0
let isMounted = true
let stopPlaylistRevisionWatch: (() => void) | null = null
const filteredRows = computed(() => filterMusicRows(songs.value, filterText.value))
const filteredSongs = computed(() => filteredRows.value.map(({ item }) => item))

const statusText = computed(() => {
  // 刷新时保留旧歌曲；只有没有可展示内容时才用加载/错误占位替换列表。
  if (!songs.value.length && isLoading.value) return window.i18n.t('account__playlist_loading')
  if (!songs.value.length && error.value) return error.value
  if (songs.value.length && !filteredSongs.value.length) return window.i18n.t('no_item')
  if (songs.value.length) return ''
  if (selectedKey.value.endsWith(':daily')) return window.i18n.t('account__playlist_no_daily')
  if (selectedKey.value) return window.i18n.t('account__playlist_no_songs')
  return window.i18n.t('account__platform_music_select')
})

const sourceName = (source: LX.Account.Source | '') => source ? window.i18n.t(`account__source_${source}` as any) : ''
const accountOptions = computed(() => groups.value.map(({ account }) => ({
  id: account.id,
  name: `${sourceName(account.source)} · ${account.nickname}`,
})))
const visibleGroups = computed(() => groups.value.filter(({ account }) => account.id === selectedAccountId.value))

const clearSelectedPlaylist = () => {
  selectedKey.value = ''
  selectedTitle.value = ''
  selectedSource.value = ''
  selectedDestination.value = null
  songs.value = []
  error.value = ''
  isLoading.value = false
  filterText.value = ''
}

const handleAccountChange = (accountId: string | number) => {
  const nextId = String(accountId)
  if (nextId === selectedAccountId.value) return
  selectedAccountId.value = nextId
  if (!selectedKey.value.startsWith(`${nextId}:`)) clearSelectedPlaylist()
}

const loadAllPlaylists = async() => {
  const sequence = ++playlistLoadSequence
  try {
    await loadAccounts()
  } catch (err: any) {
    if (isMounted && sequence === playlistLoadSequence) {
      const message = err?.message ?? window.i18n.t('list__load_failed')
      if (groups.value.length) {
        groups.value = groups.value.map(group => ({ ...group, error: message }))
      } else {
        error.value = message
      }
    }
    return
  }
  if (!isMounted || sequence !== playlistLoadSequence) return

  const accountList = [...accounts.value]
  const previousGroups = new Map(groups.value.map(group => [group.account.id, group]))
  // 刷新目录时先保留旧歌单；每个账号的请求完成后再替换自己的结果，
  // 这样慢账号不会清空已经显示的内容，失败时也能在旧列表旁显示原因。
  groups.value = accountList.map(account => ({
    account,
    playlists: previousGroups.get(account.id)?.playlists ?? [],
    error: '',
  }))
  if (!groups.value.some(({ account }) => account.id === selectedAccountId.value)) {
    const nextAccountId = groups.value[0]?.account.id ?? ''
    if (nextAccountId) handleAccountChange(nextAccountId)
    else {
      selectedAccountId.value = ''
      clearSelectedPlaylist()
    }
  }
  if (!selectedKey.value) error.value = ''

  // 每个账号独立提交结果，慢账号不会阻塞其它账号的目录显示。
  await Promise.all(accountList.map(async(account, index) => {
    try {
      const playlists = await getAccountPlaylists(account.id)
      if (!isMounted || sequence !== playlistLoadSequence) return
      groups.value[index] = { account, playlists, error: '' }
    } catch (err: any) {
      if (!isMounted || sequence !== playlistLoadSequence) return
      groups.value[index] = {
        account,
        playlists: previousGroups.get(account.id)?.playlists ?? [],
        error: err?.message ?? window.i18n.t('list__load_failed'),
      }
    }
  }))
}

const setSongs = (list: any[], tracks?: LX.Account.PlaylistTrackInfo[]) => {
  const trackMap = new Map<string, string | undefined>()
  for (const track of tracks ?? []) {
    for (const id of [
      track.id,
      track.removeId,
      track.detail?.songmid,
      track.detail?.songId,
    ]) {
      if (id != null && String(id)) trackMap.set(String(id), track.removeId)
    }
  }
  songs.value = markRawList(list.filter(Boolean).map(item => {
    const musicInfo = toNewMusicInfo(item) as LX.Music.MusicInfoOnline
    const meta = musicInfo.meta as any
    const trackId = musicInfo.source == 'kg'
      ? String(meta.hash)
      : String(meta.songId ?? meta.strMediaMid ?? '')
    meta.accountTrackId = trackMap.get(trackId)
    return musicInfo
  }))
  setTimeout(() => listRef.value?.scrollToTop())
}

/**
 * 限并发地映射一批数据。
 *
 * QQ 音乐的歌曲详情接口是「一次一首」，而歌单可能有几百首。若直接用
 * Promise.all 同时发起，会瞬间建立上百条 TLS 连接，连接会被网络栈/代理挤断，
 * 报出 "Client network socket disconnected before secure TLS connection was established"。
 * 这里把并发压到一个小窗口，既快又不会打爆连接。
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async() => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run)
  await Promise.all(runners)
  return results
}

/** QQ 音乐详情接口的并发上限：太高会被网络层掐断，太低会明显变慢。 */
const TX_DETAIL_CONCURRENCY = 6

const loadDailyDetails = async(source: LX.Account.Source, ids: string[]) => {
  switch (source) {
    case 'wy': {
      const chunks: string[][] = []
      for (let index = 0; index < ids.length; index += 500) chunks.push(ids.slice(index, index + 500))
      return (await Promise.all(chunks.map(async chunk => (await wyMusicDetail.getList(chunk)).list))).flat()
    }
    case 'tx': {
      // 逐首取详情，但严格限制同时进行的请求数（见 mapWithConcurrency 的说明）。
      // 单曲失败（下架/无版权/偶发网络抖动）不应让整个歌单加载失败，
      // 但若全军覆没就必须把错误抛出去，否则界面会只剩一个空列表、看不出原因。
      let firstError: unknown = null
      let failed = 0
      const list = await mapWithConcurrency(ids, TX_DETAIL_CONCURRENCY, async(id) => {
        try {
          return await txMusicInfo(id)
        } catch (err) {
          failed++
          firstError ??= err
          return null
        }
      })
      if (ids.length && failed === ids.length) throw firstError
      return list
    }
    case 'kg':
      return getKgMusicInfos(ids.map(hash => ({ hash })))
    case 'bili':
      return getBiliMusicInfos(ids)
  }
}

const loadPlaylistDetails = async(
  source: LX.Account.Source,
  tracks: LX.Account.PlaylistTrackInfo[],
) => {
  const details = new Array<any>(tracks.length)
  const missing: Array<{ index: number, id: string }> = []
  tracks.forEach((track, index) => {
    if (track.detail) details[index] = track.detail
    else missing.push({ index, id: track.id })
  })

  if (missing.length) {
    const loaded = await loadDailyDetails(source, missing.map(item => item.id))
    // 详情接口可能过滤下架歌曲，不能按数组下标回填，否则一首缺失会让后续歌曲错位。
    const loadedById = new Map<string, any>()
    for (const detail of loaded) {
      const id = detail?.songmid
      if (id != null && String(id)) loadedById.set(String(id), detail)
    }
    missing.forEach(item => { details[item.index] = loadedById.get(item.id) })
  }
  return details
}

const selectDaily = async(account: LX.Account.PlatformAccount) => {
  const requestSequence = ++selectionLoadSequence
  const key = `${account.id}:daily`
  const preserveSongs = selectedKey.value === key
  selectedKey.value = key
  selectedTitle.value = window.i18n.t('account__playlist_tab_daily')
  selectedSource.value = account.source
  selectedDestination.value = null
  if (!preserveSongs) songs.value = []
  error.value = ''
  isLoading.value = true
  try {
    const ids = await getAccountDailyTrackIds(account.id)
    if (!isMounted || requestSequence !== selectionLoadSequence || selectedKey.value !== key) return
    setSongs(await loadDailyDetails(account.source, ids))
  } catch (err: any) {
    if (isMounted && requestSequence === selectionLoadSequence && selectedKey.value === key) {
      error.value = err?.message ?? window.i18n.t('list__load_failed')
    }
  } finally {
    if (requestSequence === selectionLoadSequence) isLoading.value = false
  }
}

const selectPlaylist = async(account: LX.Account.PlatformAccount, playlist: LX.Account.PlaylistInfo) => {
  const key = `${account.id}:${playlist.id}`
  const preserveSongs = selectedKey.value === key
  const requestSequence = ++selectionLoadSequence
  selectedKey.value = key
  selectedTitle.value = playlist.name
  selectedSource.value = account.source
  selectedDestination.value = { account, playlist }
  if (!preserveSongs) songs.value = []
  error.value = ''
  isLoading.value = true
  try {
    const tracks = await getAccountPlaylistTrackIds(account.id, playlist.id, playlist.dirId)
    if (!isMounted || requestSequence !== selectionLoadSequence || selectedKey.value !== key) return
    setSongs(await loadPlaylistDetails(account.source, tracks), tracks)
  } catch (err: any) {
    if (isMounted && requestSequence === selectionLoadSequence && selectedKey.value === key) {
      error.value = err?.message ?? window.i18n.t('list__load_failed')
    }
  } finally {
    if (requestSequence === selectionLoadSequence) isLoading.value = false
  }
}

const refreshSelectedPlaylist = async() => {
  const account = accounts.value.find(item => item.id === selectedAccountId.value)
  const playlist = selectedDestination.value?.playlist
  if (!account || !playlist || !selectedKey.value.startsWith(`${account.id}:`)) return
  await selectPlaylist(account, playlist)
}

const refreshPlatformMusic = async() => {
  if (isRefreshing.value) return
  isRefreshing.value = true
  const account = accounts.value.find(item => item.id === selectedAccountId.value)
  const selectedPlaylist = selectedDestination.value?.playlist
  const selectedKeyValue = selectedKey.value
  const currentLoad = account && selectedKeyValue
    ? selectedKeyValue.endsWith(':daily')
      ? selectDaily(account)
      : selectedPlaylist ? selectPlaylist(account, selectedPlaylist) : Promise.resolve()
    : Promise.resolve()
  try {
    await Promise.allSettled([loadAllPlaylists(), currentLoad])
  } finally {
    isRefreshing.value = false
  }
}

const handleRemoveFromPlatform = async(musicList: LX.Music.MusicInfoOnline[]) => {
  const destination = selectedDestination.value
  if (!destination || !musicList.length) return
  const confirmed = await dialog.confirm({
    message: window.i18n.t('account__playlist_remove_confirm', { count: musicList.length }),
    cancelButtonText: window.i18n.t('cancel_button_text_2'),
    confirmButtonText: window.i18n.t('confirm_button_text'),
  })
  if (!confirmed || selectedDestination.value !== destination) return
  try {
    await removeFromPlatformPlaylist(destination, musicList)
  } catch (err: any) {
    await dialog({ message: window.i18n.t('account__playlist_remove_failed', { message: err?.message ?? String(err) }) })
  }
}

const playSongs = async(index: number) => {
  if (!songs.value.length) return
  await setTempList(`account__${selectedKey.value}`, [...songs.value])
  playList(LIST_IDS.TEMP, index)
}
const playFilteredSongs = async(index: number) => playSongs(filteredRows.value[index]?.index ?? index)
const handleShowLocator = () => {
  isShowLocator.value = true
}
const handleLocatorAction = ({ action, data }: { action: string, data?: { index: number, isPlay: boolean } }) => {
  isShowLocator.value = false
  if (action != 'listClick' || !data || data.index < 0) return
  filterText.value = ''
  void nextTick(() => {
    listRef.value?.locateMusic(data.index)
    if (data.isPlay) void playSongs(data.index)
  })
}

onMounted(() => {
  isMounted = true
  window.key_event.on('key_mod+f_down', handleShowLocator)
  stopPlaylistRevisionWatch = watch(platformPlaylistRevision, () => {
    void Promise.allSettled([refreshSelectedPlaylist(), loadAllPlaylists()])
  })
  void loadAllPlaylists().catch(console.error)
})
onBeforeUnmount(() => {
  isMounted = false
  playlistLoadSequence++
  selectionLoadSequence++
  stopPlaylistRevisionWatch?.()
  stopPlaylistRevisionWatch = null
  window.key_event.off('key_mod+f_down', handleShowLocator)
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  display: flex;
  overflow: hidden;
}

.lists {
  flex: none;
  width: 19%;
  min-width: 170px;
  display: flex;
  flex-flow: column nowrap;
  border-right: var(--color-list-header-border-bottom);
}

.header,
.listHeader {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  border-bottom: var(--color-list-header-border-bottom);
}

.header h2 {
  flex: auto;
  min-width: 0;
  padding: 0 10px;
  font-size: 12px;
  .mixin-ellipsis-1();
}
.headerInfo {
  flex: auto;
  min-width: 0;
}
.filterInput {
  width: min(280px, 35%);
  height: 30px;
  box-sizing: border-box;
  margin-right: 10px;
  padding: 0 10px;
  border: 1px solid var(--color-primary-light-400-alpha-700);
  border-radius: 4px;
  outline: none;
  color: var(--color-font);
  background: var(--color-content-background);
  &:focus {
    border-color: var(--color-primary);
  }
}

.refresh {
  width: 32px;
  height: 32px;
  padding: 8px;
  border: 0;
  color: var(--color-button-font);
  background: transparent;
  cursor: pointer;

  svg { width: 100%; height: 100%; }
}

.accountSelect {
  --selection-width: calc(100% - 20px);
  flex: none;
  margin: 8px 10px 4px;
}

.accountGroups {
  flex: auto;
  min-height: 0;
  padding: 4px 0 10px;
}

.group { margin-bottom: 8px; }

.account {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px 5px;
  color: var(--color-font);

  img {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    object-fit: cover;
  }

  span { min-width: 0; }
  strong, small { display: block; .mixin-ellipsis-1(); }
  strong { font-size: 12px; font-weight: 600; }
  small { margin-top: 2px; color: var(--color-font-label); font-size: 11px; }
}

.item {
  width: 100%;
  height: 32px;
  padding: 0 12px 0 20px;
  border: 0;
  background: transparent;
  color: var(--color-font-label);
  text-align: left;
  cursor: pointer;
  .mixin-ellipsis-1();

  &:hover { background-color: var(--color-button-background-hover); }
  &.active { color: var(--color-primary); background-color: var(--color-primary-light-400-alpha-700); }
}

.error,
.empty {
  padding: 8px 12px;
  color: var(--color-font-label);
  font-size: 11px;
  line-height: 1.4;
}

.error { color: var(--color-danger); }

.content {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
}

.listHeader {
  height: 54px;
  padding: 0 14px;
  justify-content: space-between;

  h3 { color: var(--color-font); font-size: 14px; .mixin-ellipsis-1(); }
  p { margin-top: 3px; color: var(--color-font-label); font-size: 11px; }
  .loadError { color: var(--color-danger); .mixin-ellipsis-1(); }
}

.songList {
  position: relative;
  flex: auto;
  min-height: 0;
}
</style>
