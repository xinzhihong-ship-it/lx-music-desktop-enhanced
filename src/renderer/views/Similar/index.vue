<template>
  <div :class="$style.container">
    <div :class="$style.header">
      <strong>{{ $t('similar_songs__title', { name: seedName }) }}</strong>
      <span v-if="mode" :class="$style.tip">
        {{ mode === 'platform'
          ? $t('similar_songs__platform_tip', { platform: platformName })
          : $t(hasPartialErrors ? 'list__load_failed' : 'similar_songs__unavailable') }}
      </span>
      <base-btn :class="$style.back" @click="handleBack">{{ $t('back') }}</base-btn>
    </div>
    <div :class="$style.list">
      <material-online-list
        ref="listRef"
        :page="1"
        :limit="listInfo.limit"
        :total="listInfo.total"
        :list="listInfo.list"
        :no-item="listInfo.noItemLabel"
        source-tag
        check-api-source
        @play-list="handlePlayList"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { markRaw, ref, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { useI18n } from '@renderer/plugins/i18n'
import { loadSimilarSongs, type SimilarSongSeed } from '@renderer/core/music/similar'
import { LIST_IDS } from '@common/constants'
import { playList } from '@renderer/core/player/action'
import { getListMusics, addListMusics } from '@renderer/store/list/action'
import { assertApiSupport } from '@renderer/store/utils'
import { sourceNames } from '@renderer/store'

const route = useRoute()
const router = useRouter()
const t = useI18n()
const listRef = ref<any>(null)
const mode = ref<LX.Music.SimilarSongsResult['mode'] | null>(null)
const hasPartialErrors = ref(false)
const platformName = ref('')
const seedName = ref('')
const listInfo = ref({
  limit: 50,
  total: 0,
  list: [] as LX.Music.MusicInfoOnline[],
  noItemLabel: '',
})
let requestToken = 0

const queryText = (value: unknown) => Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')

const createSeed = (): SimilarSongSeed => {
  const source = queryText(route.query.source) as LX.Source
  const songId = queryText(route.query.songId)
  return {
    id: `${source}_${songId}`,
    name: queryText(route.query.name),
    singer: queryText(route.query.singer),
    source,
    interval: queryText(route.query.interval) || null,
    meta: {
      songId,
      platformId: queryText(route.query.platformId) || undefined,
      hash: queryText(route.query.hash) || undefined,
      albumName: queryText(route.query.albumName),
    },
  }
}

const load = async() => {
  const token = ++requestToken
  const seed = createSeed()
  seedName.value = seed.name
  mode.value = null
  hasPartialErrors.value = false
  platformName.value = ''
  listInfo.value.list = []
  listInfo.value.total = 0
  listInfo.value.noItemLabel = t('list__loading')
  try {
    const result = await loadSimilarSongs(seed, listInfo.value.limit)
    if (token !== requestToken) return
    mode.value = result.mode
    hasPartialErrors.value = Boolean(result.partialErrors?.length)
    platformName.value = result.platforms?.map(platform => sourceNames.value[platform as LX.OnlineSource]).filter(Boolean).join('、') ?? '多平台'
    listInfo.value.list = result.list.map(item => markRaw(item))
    listInfo.value.total = result.list.length
    listInfo.value.noItemLabel = result.list.length
      ? ''
      : t(result.partialErrors?.length ? 'list__load_failed' : 'similar_songs__unavailable')
    if (result.list.length) setTimeout(() => listRef.value?.scrollToTop())
  } catch (error) {
    if (token !== requestToken) return
    hasPartialErrors.value = true
    console.error('[similar songs] load failed:', error)
    listInfo.value.noItemLabel = t('list__load_failed')
  }
}

const handleBack = () => {
  router.back()
}

const handlePlayList = async(index: number) => {
  const targetSong = listInfo.value.list[index]
  if (!targetSong || !assertApiSupport(targetSong.source)) return
  await addListMusics(LIST_IDS.DEFAULT, [targetSong])
  const updatedListMusics = await getListMusics(LIST_IDS.DEFAULT)
  const targetIndex = updatedListMusics.findIndex(song => song.id === targetSong.id)
  if (targetIndex >= 0) playList(LIST_IDS.DEFAULT, targetIndex)
}

watch(() => route.fullPath, async() => {
  await load()
}, { immediate: true })
</script>

<style lang="less" module>
.container {
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column nowrap;
}

.header {
  flex: none;
  min-height: 42px;
  padding: 10px 16px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
}

.tip {
  opacity: .65;
  font-size: 12px;
}

.back {
  margin-left: auto;
}

.list {
  position: relative;
  flex: auto;
  min-height: 0;
}
</style>
