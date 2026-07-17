<template>
  <div :class="$style.page">
    <header :class="$style.header">
      <h1>{{ $t('music_recognition') }}</h1>
      <div :class="$style.headerActions">
        <button :class="$style.textBtn" @click="toggleEngineSettings">
          {{ $t('music_recognition__engine_settings') }}
        </button>
        <button
          v-if="musicRecognition.history.length"
          :class="$style.textBtn"
          @click="handleClearHistory"
        >
          {{ $t('music_recognition__clear_history') }}
        </button>
      </div>
    </header>

    <section v-if="showEngineSettings" :class="$style.enginePanel">
      <base-checkbox id="music_recognition_acrcloud_enable" v-model="engineForm.enabled" :label="$t('music_recognition__acrcloud_enable')" />
      <div :class="$style.formRow">
        <span>{{ $t('music_recognition__acrcloud_host') }}</span>
        <base-input v-model="engineForm.host" :class="$style.formInput" placeholder="identify-cn-north-1.acrcloud.cn" />
      </div>
      <div :class="$style.formRow">
        <span>{{ $t('music_recognition__acrcloud_access_key') }}</span>
        <base-input v-model="engineForm.accessKey" :class="$style.formInput" />
      </div>
      <div :class="$style.formRow">
        <span>{{ $t('music_recognition__acrcloud_access_secret') }}</span>
        <base-input v-model="engineForm.accessSecret" :class="$style.formInput" type="password" />
      </div>
      <div :class="$style.formFooter">
        <p>{{ $t('music_recognition__acrcloud_tip') }}</p>
        <base-btn :class="$style.saveBtn" @click="handleSaveEngineConfig">
          {{ $t('music_recognition__acrcloud_save') }}
        </base-btn>
      </div>
    </section>

    <section :class="$style.recognizer">
      <div :class="[$style.wave, { [$style.active]: isBusy }]" aria-hidden="true">
        <i v-for="index in 9" :key="index" :style="{ animationDelay: `${index * 70}ms` }" />
      </div>
      <div :class="$style.status">
        <strong>{{ statusTitle }}</strong>
        <span v-if="statusDetail">{{ statusDetail }}</span>
      </div>
      <div v-if="musicRecognition.status === 'capturing'" :class="$style.progress">
        <i :style="{ width: `${Math.round((musicRecognition.captureProgress ?? 0) * 100)}%` }" />
      </div>
      <div v-if="!isBusy" :class="$style.sourceSwitch" role="tablist" :aria-label="$t('music_recognition__source')">
        <button
          :class="[$style.sourceBtn, { [$style.sourceBtnActive]: source === 'system' }]"
          role="tab"
          :aria-selected="source === 'system'"
          @click="source = 'system'"
        >
          {{ $t('music_recognition__source_system') }}
        </button>
        <button
          :class="[$style.sourceBtn, { [$style.sourceBtnActive]: source === 'mic' }]"
          role="tab"
          :aria-selected="source === 'mic'"
          @click="source = 'mic'"
        >
          {{ $t('music_recognition__source_mic') }}
        </button>
      </div>
      <base-btn v-if="!isBusy" :class="$style.actionBtn" @click="handleStart">
        <svg viewBox="0 0 24 24"><use xlink:href="#icon-audio-wave" /></svg>
        {{ $t('music_recognition__start') }}
      </base-btn>
      <base-btn v-else :class="$style.actionBtn" @click="handleStop">
        <svg viewBox="0 0 24 24"><use xlink:href="#icon-close" /></svg>
        {{ $t('music_recognition__stop') }}
      </base-btn>
    </section>

    <section v-if="resultRows.length" :class="$style.result">
      <h2>{{ $t('music_recognition__current_result') }}</h2>
      <article v-for="item in resultRows" :key="item.id" :class="[$style.row, $style.resultRow, $style.topMatch]">
        <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title">
        <div v-else :class="$style.coverFallback">
          <svg viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
        </div>
        <div :class="$style.trackInfo">
          <strong>{{ item.title }}<em :class="$style.providerTag">{{ item.provider === 'acrcloud' ? 'ACRCloud' : 'Shazam' }}</em></strong>
          <span>{{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template></span>
        </div>
        <div :class="$style.rowActions">
          <button :aria-label="$t('music_recognition__search')" @click="handleSearch(item)">
            <svg viewBox="0 0 425.2 425.2"><use xlink:href="#icon-search-2" /></svg>
          </button>
          <button :aria-label="$t('music_recognition__copy')" @click="handleCopy(item)">
            <svg viewBox="0 0 24 24"><use xlink:href="#icon-text" /></svg>
          </button>
          <button v-if="item.shazamUrl" :aria-label="$t('music_recognition__open_shazam')" @click="handleOpen(item)">
            <svg viewBox="0 0 451.847 451.847"><use xlink:href="#icon-right" /></svg>
          </button>
        </div>
      </article>
      <template v-if="alternatives.length">
        <h3>{{ $t('music_recognition__alternatives') }}</h3>
        <div class="scroll" :class="$style.altList">
          <article v-for="item in alternatives" :key="item.id" :class="[$style.row, $style.resultRow]">
            <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title">
            <div v-else :class="$style.coverFallback">
              <svg viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
            </div>
            <div :class="$style.trackInfo">
              <strong>{{ item.title }}<em :class="$style.providerTag">{{ item.provider === 'acrcloud' ? 'ACRCloud' : 'Shazam' }}</em></strong>
              <span>{{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template></span>
            </div>
            <div :class="$style.rowActions">
              <button :aria-label="$t('music_recognition__search')" @click="handleSearch(item)">
                <svg viewBox="0 0 425.2 425.2"><use xlink:href="#icon-search-2" /></svg>
              </button>
              <button :aria-label="$t('music_recognition__copy')" @click="handleCopy(item)">
                <svg viewBox="0 0 24 24"><use xlink:href="#icon-text" /></svg>
              </button>
              <button v-if="item.shazamUrl" :aria-label="$t('music_recognition__open_shazam')" @click="handleOpen(item)">
                <svg viewBox="0 0 451.847 451.847"><use xlink:href="#icon-right" /></svg>
              </button>
            </div>
          </article>
        </div>
      </template>
    </section>

    <section :class="$style.history">
      <h2>{{ $t('music_recognition__history') }}</h2>
      <div v-if="musicRecognition.history.length" class="scroll" :class="$style.list">
        <article v-for="item in musicRecognition.history" :key="item.id" :class="$style.row">
          <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title">
          <div v-else :class="$style.coverFallback">
            <svg viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
          </div>
          <div :class="$style.trackInfo">
            <strong>{{ item.title }}<em v-if="item.provider === 'acrcloud'" :class="$style.providerTag">ACRCloud</em></strong>
            <span>{{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template></span>
          </div>
          <time>{{ formatTime(item.recognizedAt) }}</time>
          <div :class="$style.rowActions">
            <button :aria-label="$t('music_recognition__search')" @click="handleSearch(item)">
              <svg viewBox="0 0 425.2 425.2"><use xlink:href="#icon-search-2" /></svg>
            </button>
            <button :aria-label="$t('music_recognition__copy')" @click="handleCopy(item)">
              <svg viewBox="0 0 24 24"><use xlink:href="#icon-text" /></svg>
            </button>
            <button v-if="item.shazamUrl" :aria-label="$t('music_recognition__open_shazam')" @click="handleOpen(item)">
              <svg viewBox="0 0 451.847 451.847"><use xlink:href="#icon-right" /></svg>
            </button>
            <button :aria-label="$t('music_recognition__remove')" @click="handleRemove(item)">
              <svg viewBox="0 0 212.982 212.982"><use xlink:href="#icon-delete" /></svg>
            </button>
          </div>
        </article>
      </div>
      <div v-else :class="$style.empty">{{ $t('music_recognition__empty') }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText, openUrl } from '@common/utils/electron'
import {
  acrcloudConfig,
  clearRecognitionHistory,
  initMusicRecognition,
  loadAcrcloudConfig,
  musicRecognition,
  removeRecognitionHistoryItem,
  saveAcrcloudConfig,
  startMicRecognition,
  startSystemRecognition,
  stopRecognition,
} from '@renderer/store/musicRecognition'

const router = useRouter()
const source = ref<LX.MusicRecognition.Source>('system')
const isBusy = computed(() => ['requestingPermission', 'capturing', 'recognizing'].includes(musicRecognition.status))
const resultRows = computed(() => musicRecognition.result ? [musicRecognition.result] : [])
const alternatives = computed(() => musicRecognition.alternatives ?? [])

const showEngineSettings = ref(false)
const engineForm = reactive<LX.MusicRecognition.AcrcloudConfig>({
  enabled: false,
  host: '',
  accessKey: '',
  accessSecret: '',
})
const toggleEngineSettings = () => {
  if (!showEngineSettings.value) Object.assign(engineForm, acrcloudConfig)
  showEngineSettings.value = !showEngineSettings.value
}
const handleSaveEngineConfig = () => {
  void saveAcrcloudConfig({ ...engineForm })
  showEngineSettings.value = false
}

const statusTitle = computed(() => {
  if (musicRecognition.status === 'idle' && source.value === 'mic') return window.i18n.t('music_recognition__status_idle_mic' as any)
  return window.i18n.t(`music_recognition__status_${musicRecognition.status}` as any)
})
const statusDetail = computed(() => {
  if (['permissionDenied', 'noAudio', 'networkError', 'error'].includes(musicRecognition.status)) return musicRecognition.error ?? ''
  if (musicRecognition.status === 'capturing') {
    return window.i18n.t('music_recognition__capture_progress' as any, {
      progress: Math.round((musicRecognition.captureProgress ?? 0) * 100),
    })
  }
  return ''
})

const handleStart = () => {
  if (source.value === 'mic') {
    void startMicRecognition()
  } else {
    void startSystemRecognition()
  }
}
const handleStop = () => {
  void stopRecognition()
}
const handleClearHistory = () => {
  void clearRecognitionHistory()
}
const handleRemove = (item: LX.MusicRecognition.Result) => {
  void removeRecognitionHistoryItem(item.id)
}
const handleSearch = (item: LX.MusicRecognition.Result) => {
  void router.push({
    path: '/search',
    query: { text: `${item.title} ${item.artist}`, source: 'all', type: 'music', page: 1 },
  })
}
const handleCopy = (item: LX.MusicRecognition.Result) => {
  clipboardWriteText(`${item.title} - ${item.artist}`)
}
const handleOpen = (item: LX.MusicRecognition.Result) => {
  if (item.shazamUrl) void openUrl(item.shazamUrl)
}
const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

onMounted(() => {
  void initMusicRecognition()
  void loadAcrcloudConfig()
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.page {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
}
.header {
  flex: none;
  height: 54px;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-primary-light-600-alpha-700);
  h1 {
    font-size: 18px;
    font-weight: 600;
  }
}
.headerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.enginePanel {
  flex: none;
  padding: 12px 22px 14px;
  display: flex;
  flex-flow: column nowrap;
  gap: 10px;
  border-bottom: 1px solid var(--color-primary-light-600-alpha-700);
}
.formRow {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  span { font-size: 13px; opacity: .75; }
}
.formInput { width: 100%; }
.formFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  p {
    margin: 0;
    font-size: 12px;
    opacity: .6;
  }
}
.saveBtn {
  flex: none;
  height: 30px;
  padding: 0 18px;
}
.textBtn {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  &:hover { background: var(--color-button-background-hover); }
}
.rowActions button {
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  svg { width: 17px; height: 17px; fill: currentColor; }
  &:hover { background: var(--color-button-background-hover); }
}
.recognizer {
  flex: none;
  min-height: 168px;
  padding: 16px 24px;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--color-primary-light-600-alpha-700);
}
.wave {
  width: 120px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  i {
    display: block;
    width: 5px;
    height: 12px;
    background: var(--color-primary);
    opacity: .45;
    transform-origin: center;
  }
  &.active i { animation: wave 900ms ease-in-out infinite alternate; }
}
.status {
  min-height: 40px;
  text-align: center;
  display: flex;
  flex-flow: column nowrap;
  gap: 4px;
  strong { font-size: 15px; font-weight: 600; }
  span { font-size: 12px; opacity: .72; }
}
.progress {
  width: min(320px, 70%);
  height: 3px;
  margin: 4px 0 12px;
  background: var(--color-primary-light-600-alpha-700);
  overflow: hidden;
  i {
    display: block;
    height: 100%;
    background: var(--color-primary);
    transition: width 160ms linear;
  }
}
.actionBtn {
  min-width: 126px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  svg { width: 18px; height: 18px; fill: currentColor; }
}
.sourceSwitch {
  display: inline-flex;
  margin-bottom: 12px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-primary-light-600-alpha-700);
}
.sourceBtn {
  min-width: 88px;
  height: 30px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  opacity: .65;
  &:hover { background: var(--color-button-background-hover); }
}
.sourceBtnActive {
  background: var(--color-primary-light-400-alpha-700);
  opacity: 1;
  font-weight: 600;
}
.result {
  flex: none;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  border-bottom: 1px solid var(--color-primary-light-600-alpha-700);
  h2 {
    flex: none;
    padding: 12px 22px 8px;
    font-size: 14px;
    font-weight: 600;
  }
  h3 {
    flex: none;
    padding: 6px 22px;
    font-size: 12px;
    font-weight: 600;
    opacity: .7;
  }
}
.altList { flex: none; max-height: 200px; padding: 0 14px 8px; }
.resultRow {
  min-height: 56px;
  grid-template-columns: 44px minmax(0, 1fr) 108px;
  img,
  .coverFallback {
    width: 44px;
    height: 44px;
  }
}
.topMatch {
  min-height: 64px;
  margin: 0 14px;
  grid-template-columns: 50px minmax(0, 1fr) 108px;
  img,
  .coverFallback {
    width: 50px;
    height: 50px;
  }
}
.history {
  flex: auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  h2 {
    flex: none;
    padding: 12px 22px 8px;
    font-size: 14px;
    font-weight: 600;
  }
}
.list { flex: auto; min-height: 0; padding: 0 14px 14px; }
.row {
  min-height: 68px;
  padding: 8px;
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr) 110px 140px;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--color-primary-light-700-alpha-700);
  img,
  .coverFallback {
    width: 50px;
    height: 50px;
    object-fit: cover;
  }
  time { font-size: 12px; opacity: .6; white-space: nowrap; }
}
.coverFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light-500-alpha-700);
  svg { width: 22px; height: 22px; fill: currentColor; opacity: .65; }
}
.trackInfo {
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 5px;
  strong,
  span { .mixin-ellipsis-1(); }
  strong { font-size: 14px; }
  span { font-size: 12px; opacity: .7; }
}
.providerTag {
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  padding: 1px 5px;
  margin-left: 6px;
  border-radius: 3px;
  white-space: nowrap;
  background: var(--color-primary-light-400-alpha-700);
  vertical-align: 1px;
}
.rowActions { display: flex; justify-content: flex-end; }
.empty {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .5;
  font-size: 13px;
}

@keyframes wave {
  from { transform: scaleY(.55); opacity: .45; }
  to { transform: scaleY(3.6); opacity: 1; }
}

@media (max-width: 700px) {
  .row { grid-template-columns: 46px minmax(0, 1fr) 140px; }
  .row time { display: none; }
}
</style>
