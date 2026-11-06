<template>
  <material-modal :show="show" :bg-close="true" teleport="#root" width="640px" max-width="92%" max-height="86%" @close="close">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('lyric_search__title') }}</h2>
      <p v-if="binding" :class="$style.bound">
        {{ $t('lyric_search__bound', { platform: platformName(binding.platform), name: binding.name, singer: binding.singer }) }}
        <button type="button" :class="$style.link" @click="handleRestore">{{ $t('lyric_search__restore') }}</button>
      </p>
      <div :class="$style.searchBar">
        <base-input v-model="keyword" :class="$style.input" :placeholder="$t('lyric_search__placeholder')" @submit="handleSearch" />
        <base-btn :class="$style.searchBtn" :disabled="loading" @click="handleSearch">{{ loading ? $t('lyric_search__searching') : $t('lyric_search__search') }}</base-btn>
      </div>
      <base-tab v-model="platform" :class="$style.tabs" :list="platformTabs" item-key="id" item-label="label" @change="handleSearch" />

      <div :class="$style.body">
        <ul :class="[$style.list, 'scroll']" role="listbox" :aria-label="$t('lyric_search__title')">
          <li v-if="!loading && searched && !candidates.length" :class="$style.empty">{{ $t('lyric_search__empty') }}</li>
          <li
            v-for="candidate in candidates" :key="candidate.key"
            :class="[$style.item, { [$style.active]: selected?.key == candidate.key, [$style.weak]: candidate.score == null || candidate.score < AUTO_MATCH_SCORE }]"
            role="option" :aria-selected="selected?.key == candidate.key" tabindex="0"
            @click="handlePreview(candidate)" @keyup.enter="handlePreview(candidate)"
          >
            <div :class="$style.itemMain">
              <span :class="$style.name">{{ candidate.name }}</span>
              <span :class="$style.singer">{{ candidate.singer }}</span>
            </div>
            <div :class="$style.itemMeta">
              <span :class="$style.platform">{{ platformName(candidate.platform) }}</span>
              <span>{{ candidate.interval || '--:--' }}</span>
              <span v-if="durationGap(candidate) != null" :class="$style.gap">{{ formatGap(durationGap(candidate)) }}</span>
              <template v-if="features[candidate.key]">
                <span v-if="features[candidate.key].hasWords" :class="$style.badge">{{ $t('lyric_search__badge_words') }}</span>
                <span v-if="features[candidate.key].hasTranslation" :class="$style.badge">{{ $t('lyric_search__badge_translation') }}</span>
                <span v-if="features[candidate.key].hasRoma" :class="$style.badge">{{ $t('lyric_search__badge_roma') }}</span>
              </template>
            </div>
          </li>
        </ul>

        <section :class="$style.preview" aria-live="polite">
          <template v-if="selected">
            <p v-if="previewLoading" :class="$style.hint">{{ $t('lyric_search__preview_loading') }}</p>
            <p v-else-if="previewError" :class="$style.hint">{{ previewError }}</p>
            <template v-else>
              <ol :class="[$style.lines, 'scroll']">
                <li v-for="(line, index) in previewLines" :key="index">
                  <span>{{ line.text }}</span>
                  <span v-if="line.translation" :class="$style.translation">{{ line.translation }}</span>
                </li>
              </ol>
              <base-btn :class="$style.useBtn" :disabled="applying" @click="handleApply">{{ $t('lyric_search__use') }}</base-btn>
            </template>
          </template>
          <p v-else :class="$style.hint">{{ $t('lyric_search__preview_tip') }}</p>
        </section>
      </div>

      <footer :class="$style.footer">
        <span v-if="failedText" :class="$style.failed">{{ failedText }}</span>
        <label :class="$style.link" tabindex="0">
          {{ $t('lyric_search__import') }}
          <input type="file" accept=".lrc,.txt" :class="$style.file" @change="handleImport">
        </label>
      </footer>
    </main>
  </material-modal>
</template>

<script setup>
import { computed, reactive, ref, shallowRef, watch } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { AUTO_MATCH_SCORE, buildLyricDoc, buildSearchKeyword, hasTimedLyric } from '@common/utils/lyrics'
import { fetchCandidateLyric, LYRIC_PLATFORMS, searchLyricCandidates } from '@renderer/core/lyrics/search'
import { getBinding, getMatchSubject, getSongMusicInfo, unbindLyric } from '@renderer/core/lyrics/binding'
import { applyLyricCandidate, reloadLyric, restoreAutoLyric } from '@renderer/core/lyrics/actions'
import { saveLyricEdited } from '@renderer/utils/ipc'

const PREVIEW_LINES = 8

const props = defineProps({
  show: { type: Boolean, default: false },
  musicInfo: { type: [Object, null], default: null },
})
const emit = defineEmits(['update:show'])
const t = useI18n()

const keyword = ref('')
const platform = ref('all')
const loading = ref(false)
const searched = ref(false)
const candidates = shallowRef([])
const failed = ref([])
const selected = shallowRef(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewLines = shallowRef([])
const features = reactive({})
const applying = ref(false)
const binding = ref(null)
let searchId = 0
let previewId = 0

const subject = computed(() => props.musicInfo ? getMatchSubject(props.musicInfo) : null)
const platformName = id => t(`source_${id}`)
const platformTabs = computed(() => [
  { id: 'all', label: t('lyric_search__platform_all') },
  ...LYRIC_PLATFORMS.map(id => ({ id, label: platformName(id) })),
])
const failedText = computed(() => failed.value.length
  ? t('lyric_search__failed', { platforms: failed.value.map(platformName).join('、') })
  : '')

const durationGap = candidate => {
  const duration = subject.value?.duration ?? 0
  return duration > 0 && candidate.duration > 0 ? candidate.duration - duration : null
}
const formatGap = gap => gap == 0 ? '±0s' : `${gap > 0 ? '+' : ''}${gap}s`

const close = () => { emit('update:show', false) }

const handleSearch = async() => {
  if (!subject.value) return
  const id = ++searchId
  loading.value = true
  selected.value = null
  try {
    const result = await searchLyricCandidates({
      keyword: keyword.value,
      query: subject.value,
      platforms: platform.value == 'all' ? LYRIC_PLATFORMS : [platform.value],
    })
    if (id != searchId) return
    candidates.value = result.candidates
    failed.value = result.failed
  } finally {
    if (id == searchId) {
      loading.value = false
      searched.value = true
    }
  }
}

const handlePreview = async candidate => {
  const id = ++previewId
  selected.value = candidate
  previewLoading.value = true
  previewError.value = ''
  try {
    const lyricInfo = await fetchCandidateLyric(candidate)
    if (id != previewId) return
    const doc = buildLyricDoc(lyricInfo)
    features[candidate.key] = { hasWords: doc.hasWords, hasTranslation: doc.hasTranslation, hasRoma: doc.hasRoma }
    previewLines.value = doc.lines.slice(0, PREVIEW_LINES)
  } catch {
    if (id != previewId) return
    previewError.value = t('lyric_search__preview_failed')
  } finally {
    if (id == previewId) previewLoading.value = false
  }
}

const handleApply = async() => {
  if (!selected.value || !props.musicInfo) return
  applying.value = true
  try {
    await applyLyricCandidate(props.musicInfo, selected.value)
    close()
  } catch (err) {
    console.error(err)
    previewError.value = t('lyric_search__apply_failed')
  } finally {
    applying.value = false
  }
}

const handleRestore = async() => {
  if (!props.musicInfo) return
  await restoreAutoLyric(props.musicInfo).catch(err => { console.error(err) })
  binding.value = null
}

// 导入本地 LRC：作为本首的“已编辑歌词”保存（并解除绑定，否则绑定优先）
const handleImport = async event => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !props.musicInfo) return
  const text = await file.text()
  if (!hasTimedLyric(text)) {
    previewError.value = t('lyric_search__import_invalid')
    selected.value = { key: '__import__' }
    return
  }
  await unbindLyric(props.musicInfo)
  await saveLyricEdited(getSongMusicInfo(props.musicInfo), { lyric: text, tlyric: '', rlyric: '', lxlyric: '' })
  await reloadLyric(props.musicInfo)
  close()
}

watch(() => props.show, async show => {
  if (!show || !props.musicInfo) return
  keyword.value = subject.value ? buildSearchKeyword(subject.value) : ''
  platform.value = 'all'
  candidates.value = []
  failed.value = []
  selected.value = null
  searched.value = false
  binding.value = await getBinding(props.musicInfo).catch(() => null)
  void handleSearch()
}, { immediate: true })
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 18px;
  display: flex;
  flex-flow: column nowrap;
  gap: 10px;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}
.title {
  font-size: 14px;
  color: var(--color-font);
  text-align: center;
}
.bound {
  font-size: 12px;
  color: var(--color-font-label);
}
.searchBar {
  display: flex;
  gap: 8px;
}
.input {
  flex: auto;
  min-width: 0;
}
.searchBtn {
  flex: none;
}
.body {
  display: flex;
  gap: 12px;
  min-height: 260px;
  height: 46vh;
}
.list {
  flex: 1 1 55%;
  min-width: 0;
  overflow-y: auto;
}
.empty, .hint {
  padding: 20px 8px;
  font-size: 12px;
  color: var(--color-font-label);
  text-align: center;
}
.item {
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color .2s ease;
  &:hover, &:focus-visible {
    background-color: var(--color-button-background-hover);
    outline: none;
  }
  &.active {
    background-color: var(--color-button-background-active);
  }
  &.weak {
    opacity: .7;
  }
}
.itemMain {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
.name {
  font-size: 13px;
  color: var(--color-font);
  .mixin-ellipsis-1();
}
.singer {
  flex: none;
  max-width: 45%;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.itemMeta {
  margin-top: 3px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--color-font-label);
}
.platform {
  color: var(--color-primary);
}
.badge {
  padding: 0 5px;
  border-radius: 4px;
  background-color: var(--color-primary-alpha-900);
  color: var(--color-primary);
}
.preview {
  flex: 1 1 45%;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 10px;
  border-left: 1px solid var(--color-primary-alpha-900);
  padding-left: 12px;
}
.lines {
  flex: auto;
  min-height: 0;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-font);
  li {
    display: flex;
    flex-flow: column nowrap;
  }
}
.translation {
  font-size: 12px;
  color: var(--color-font-label);
}
.useBtn {
  flex: none;
  align-self: flex-end;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.failed {
  color: var(--color-font-label);
}
.link {
  margin-left: auto;
  color: var(--color-primary);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
}
.file {
  display: none;
}
</style>
