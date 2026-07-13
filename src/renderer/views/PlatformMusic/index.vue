<template>
  <div :class="$style.container">
    <aside :class="$style.lists">
      <div :class="$style.header">
        <h2>{{ $t('account__platform_music') }}</h2>
        <button :class="$style.refresh" :aria-label="$t('account__playlist_refresh')" @click="loadAllPlaylists">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
            <use xlink:href="#icon-refresh" />
          </svg>
        </button>
      </div>
      <div class="scroll" :class="$style.accountGroups">
        <section v-for="group in groups" :key="group.account.id" :class="$style.group">
          <div :class="$style.account">
            <img v-if="group.account.avatar" :src="group.account.avatar">
            <span>
              <strong>{{ sourceName(group.account.source) }}</strong>
              <small>{{ group.account.nickname }}</small>
            </span>
          </div>
          <button
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
        <div>
          <h3>{{ selectedTitle || $t('account__platform_music_select') }}</h3>
          <p v-if="selectedSource">{{ sourceName(selectedSource) }}</p>
        </div>
        <base-btn v-if="songs.length" outline @click="playSongs(0)">{{ $t('list__play') }}</base-btn>
      </div>
      <div :class="$style.songList">
        <material-online-list
          ref="listRef"
          :page="1"
          :limit="Math.max(songs.length, 1)"
          :total="songs.length"
          :list="songs"
          :no-item="statusText"
          :allow-platform-remove="Boolean(selectedDestination?.playlist.isEditable)"
          @play-list="playSongs"
          @remove-from-platform="handleRemoveFromPlatform"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, markRawList, onMounted, ref } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { playList } from '@renderer/core/player'
import { setTempList } from '@renderer/store/list/action'
import {
  accounts,
  loadAccounts,
  removeFromPlatformPlaylist,
  type PlatformPlaylistDestination,
} from '@renderer/store/account'
import { getAccountDailyTrackIds, getAccountPlaylists, getAccountPlaylistTrackIds } from '@renderer/utils/ipc'
import { toNewMusicInfo } from '@renderer/utils'
import { getMusicInfos as getKgMusicInfos } from '@renderer/utils/musicSdk/kg/musicInfo'
import txMusicInfo from '@renderer/utils/musicSdk/tx/musicInfo'
import wyMusicDetail from '@renderer/utils/musicSdk/wy/musicDetail'
import { dialog } from '@renderer/plugins/Dialog'

interface AccountGroup {
  account: LX.Account.PlatformAccount
  playlists: LX.Account.PlaylistInfo[]
  error: string
}

const groups = ref<AccountGroup[]>([])
const songs = ref<LX.Music.MusicInfoOnline[]>([])
const selectedKey = ref('')
const selectedTitle = ref('')
const selectedSource = ref<LX.Account.Source | ''>('')
const selectedDestination = ref<PlatformPlaylistDestination | null>(null)
const isLoading = ref(false)
const error = ref('')
const listRef = ref<any>(null)

const statusText = computed(() => {
  if (isLoading.value) return window.i18n.t('account__playlist_loading')
  if (error.value) return error.value
  if (songs.value.length) return ''
  if (selectedKey.value.endsWith(':daily')) return window.i18n.t('account__playlist_no_daily')
  if (selectedKey.value) return window.i18n.t('account__playlist_no_songs')
  return window.i18n.t('account__platform_music_select')
})

const sourceName = (source: LX.Account.Source | '') => source ? window.i18n.t(`account__source_${source}` as any) : ''

const loadAllPlaylists = async() => {
  await loadAccounts()
  groups.value = await Promise.all(accounts.value.map(async account => {
    try {
      return { account, playlists: await getAccountPlaylists(account.id), error: '' }
    } catch (err: any) {
      return { account, playlists: [], error: err?.message ?? window.i18n.t('list__load_failed') }
    }
  }))
}

const setSongs = (list: any[], tracks?: LX.Account.PlaylistTrackInfo[]) => {
  const trackMap = new Map(tracks?.map(track => [track.id, track.removeId]))
  songs.value = markRawList(list.map(item => {
    const musicInfo = toNewMusicInfo(item) as LX.Music.MusicInfoOnline
    const trackId = musicInfo.source == 'kg' ? musicInfo.meta.hash : String(musicInfo.meta.songId)
    musicInfo.meta.accountTrackId = trackMap.get(trackId)
    return musicInfo
  }))
  setTimeout(() => listRef.value?.scrollToTop())
}

const loadDailyDetails = async(source: LX.Account.Source, ids: string[]) => {
  switch (source) {
    case 'wy': {
      const chunks: string[][] = []
      for (let index = 0; index < ids.length; index += 500) chunks.push(ids.slice(index, index + 500))
      return (await Promise.all(chunks.map(async chunk => (await wyMusicDetail.getList(chunk)).list))).flat()
    }
    case 'tx':
      return (await Promise.all(ids.map(txMusicInfo))).filter(Boolean)
    case 'kg':
      return getKgMusicInfos(ids.map(hash => ({ hash })))
  }
}

const selectDaily = async(account: LX.Account.PlatformAccount) => {
  selectedKey.value = `${account.id}:daily`
  selectedTitle.value = window.i18n.t('account__playlist_tab_daily')
  selectedSource.value = account.source
  selectedDestination.value = null
  songs.value = []
  error.value = ''
  isLoading.value = true
  try {
    const ids = await getAccountDailyTrackIds(account.id)
    if (selectedKey.value !== `${account.id}:daily`) return
    setSongs(await loadDailyDetails(account.source, ids))
  } catch (err: any) {
    error.value = err?.message ?? window.i18n.t('list__load_failed')
  } finally {
    isLoading.value = false
  }
}

const selectPlaylist = async(account: LX.Account.PlatformAccount, playlist: LX.Account.PlaylistInfo) => {
  const key = `${account.id}:${playlist.id}`
  selectedKey.value = key
  selectedTitle.value = playlist.name
  selectedSource.value = account.source
  selectedDestination.value = { account, playlist }
  songs.value = []
  error.value = ''
  isLoading.value = true
  try {
    const tracks = await getAccountPlaylistTrackIds(account.id, playlist.id, playlist.dirId)
    if (selectedKey.value !== key) return
    setSongs(await loadDailyDetails(account.source, tracks.map(track => track.id)), tracks)
  } catch (err: any) {
    error.value = err?.message ?? window.i18n.t('list__load_failed')
  } finally {
    isLoading.value = false
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
    await selectPlaylist(destination.account, destination.playlist)
  } catch (err: any) {
    await dialog({ message: window.i18n.t('account__playlist_remove_failed', { message: err?.message ?? String(err) }) })
  }
}

const playSongs = async(index: number) => {
  if (!songs.value.length) return
  await setTempList(`account__${selectedKey.value}`, [...songs.value])
  playList(LIST_IDS.TEMP, index)
}

onMounted(() => {
  loadAllPlaylists().catch(console.error)
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
}

.songList {
  position: relative;
  flex: auto;
  min-height: 0;
}
</style>
