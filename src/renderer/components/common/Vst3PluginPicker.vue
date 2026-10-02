<template>
  <teleport to="#root">
    <transition name="fade">
      <div v-if="show" :class="$style.backdrop" @click.self="$emit('close')">
        <aside :class="$style.panel">
          <header :class="$style.header">
            <div :class="$style.title">
              <svg viewBox="0 0 24 24">
                <use xlink:href="#icon-plugin" />
              </svg>
              <h2>{{ $t('player__vst3_picker_title') }}</h2>
              <span :class="$style.count">{{ filtered.length }}</span>
            </div>
            <div :class="$style.headerActions">
              <button type="button" :class="$style.iconBtn" :disabled="scanning" :aria-label="$t(scanning ? 'setting__vst3_scanning' : 'setting__vst3_scan')" :title="$t(scanning ? 'setting__vst3_scanning' : 'setting__vst3_scan')" @click="scan">
                <svg viewBox="0 0 24 24">
                  <use xlink:href="#icon-refresh" />
                </svg>
              </button>
              <button type="button" :class="$style.iconBtn" :aria-label="$t('close')" :title="$t('close')" @click="$emit('close')">
                <svg viewBox="0 0 24 24">
                  <use xlink:href="#icon-close" />
                </svg>
              </button>
            </div>
          </header>
          <div :class="$style.toolbar">
            <input v-model="filterText" :class="$style.filterInput" type="search" :placeholder="$t('player__vst3_search')">
          </div>
          <section :class="$style.current">
            <div v-if="scanning" :class="$style.progress">
              <p :class="$style.progressTitle">{{ progressLabel }}</p>
              <div
                :class="$style.progressTrack"
                role="progressbar"
                :aria-label="progressLabel"
                :aria-valuemin="0"
                :aria-valuemax="progressIndeterminate ? undefined : progressMax"
                :aria-valuenow="progressIndeterminate ? undefined : progressValue"
              >
                <div
                  :class="[$style.progressBar, progressIndeterminate ? $style.progressBarIndeterminate : '']"
                  :style="progressIndeterminate ? undefined : { width: progressPercent + '%' }"
                />
              </div>
              <p v-if="!progressIndeterminate" :class="$style.progressHint">{{ $t('player__vst3_scan_completed', { current: progressValue, total: progressMax, percent: progressPercent }) }}</p>
              <p v-if="progressPath" :class="$style.progressPath" :title="progressPath">{{ progressPath }}</p>
              <p :class="$style.progressHint">{{ $t('player__vst3_scan_elapsed', { time: progressSeconds }) }}</p>
            </div>
            <p v-else-if="!filtered.length" :class="$style.empty">
              {{ plugins.length ? $t('player__vst3_empty_result') : $t('player__vst3_scan_hint') }}
              <button v-if="!plugins.length" type="button" :class="$style.linkButton" @click="scan">{{ $t('setting__vst3_scan') }}</button>
            </p>
            <base-virtualized-list
              v-else
              :list="filtered"
              key-name="path"
              :item-height="44"
              :container-class="`${$style.listScroll} music-list-scroll`"
            >
              <template #default="{ item }">
                <div :class="$style.item" :title="item.path">
                  <span :class="$style.pluginName">{{ item.details.info.name }} — {{ item.details.info.vendor }}</span>
                  <span v-if="addedPaths.has(item.path)" :class="$style.addedTag">{{ $t('player__vst3_added') }}</span>
                  <button v-else type="button" :class="$style.addBtn" :disabled="chainFull" @click="addPlugin(item.path)">{{ $t('setting__vst3_add_plugin') }}</button>
                </div>
              </template>
            </base-virtualized-list>
          </section>
          <footer :class="$style.footer">
            <p v-if="error" role="alert" :class="$style.error">{{ error }}</p>
            <p v-else-if="warnings.length" :class="$style.warning">{{ $t('player__vst3_dir_skipped', { list: warnings.map(warning => warning.path).join('、') }) }}</p>
            <p v-else-if="scanTime" :class="$style.warning">{{ $t('player__vst3_scan_time', { time: new Date(scanTime).toLocaleString() }) }}</p>
          </footer>
        </aside>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { onVst3ScanProgress, scanVst3Plugins } from '@renderer/utils/ipc'
import { randomUUID } from 'node:crypto'
import { cleanVst3Error, plainVst3Chain } from '@renderer/plugins/player/vst3'
import { useI18n } from '@root/lang'

const t = useI18n()

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
})
defineEmits(['close'])

// 每个面板保留内存结果，多个面板通过持久化缓存复用结果。
const plugins = ref([])
const warnings = ref([])
const scanning = ref(false)
const error = ref('')
const filterText = ref('')
const scanned = ref(false)
const scanTime = ref(0)

// 扫描进度：主进程每探完一个插件推送一次。探测单个插件要新建宿主进程并加载模块，
// 可能耗时数秒，没有进度界面就会长时间空白，看起来像卡死。
const scanProgress = ref(null)
const progressSeconds = ref(0)
let stopProgressListener = null
let progressTimer = null

const stopProgressWatch = () => {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
  if (stopProgressListener) {
    stopProgressListener()
    stopProgressListener = null
  }
  progressSeconds.value = 0
}
let scanToken = 0
onBeforeUnmount(() => {
  ++scanToken
  stopProgressWatch()
})

const progressLabel = computed(() => {
  const progress = scanProgress.value
  if (!progress) return t('setting__vst3_scanning')
  if (progress.phase === 'discover') {
    return t('player__vst3_scan_discovering', { found: progress.found ?? 0 })
  }
  if (progress.phase === 'probe') {
    if (progress.error) return t('player__vst3_scan_failed', { name: progress.path ?? '' })
    if (progress.name) return t('player__vst3_scan_probed', { name: progress.name })
    return t('player__vst3_scan_probing', { name: progress.path ?? '' })
  }
  return t('setting__vst3_scanning')
})
const progressMax = computed(() => scanProgress.value?.total ?? 0)
const progressValue = computed(() => scanProgress.value?.current ?? 0)
const progressIndeterminate = computed(() => {
  const progress = scanProgress.value
  return !progress || progress.phase === 'discover' || !progress.total
})
const progressPercent = computed(() => {
  if (progressIndeterminate.value) return 0
  return Math.min(100, Math.floor((progressValue.value / progressMax.value) * 100))
})
const progressPath = computed(() => scanProgress.value?.path ?? '')

const startProgressWatch = () => {
  stopProgressWatch()
  scanProgress.value = null
  progressSeconds.value = 0
  let startedAt = Date.now()
  progressTimer = setInterval(() => {
    progressSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 500)
  stopProgressListener = onVst3ScanProgress(progress => {
    scanProgress.value = progress
    if (Number.isFinite(progress.elapsed)) {
      startedAt = Date.now() - progress.elapsed
      progressSeconds.value = Math.floor(progress.elapsed / 1000)
    }
  })
}

const filtered = computed(() => {
  const keyword = filterText.value.trim().toLowerCase()
  if (!keyword) return plugins.value
  return plugins.value.filter(plugin => {
    const { name, vendor } = plugin.details.info
    return name.toLowerCase().includes(keyword) || vendor.toLowerCase().includes(keyword) || plugin.path.toLowerCase().includes(keyword)
  })
})
const addedPaths = computed(() => new Set(appSetting['player.vst3.chain'].map(slot => slot.path)))
const chainFull = computed(() => appSetting['player.vst3.chain'].length >= 16)

// 扫描结果持久化到 localStorage，应用重启后可复用；手动刷新或自定义目录变化时重新扫描。
const SCAN_CACHE_KEY = 'lx_vst3_scan_cache'

// 缓存目录用 JSON 编码，避免路径中的换行符造成指纹碰撞。
const directoriesKey = directories => JSON.stringify((Array.isArray(directories) ? [...directories] : [])
  .sort((a, b) => a.localeCompare(b)))
const directoryFingerprint = () => directoriesKey(appSetting['player.vst3.directories'])
const cacheMatchesDirectories = cached => cached?.version === 2 && Array.isArray(cached.directories) &&
  directoriesKey(cached.directories) === directoryFingerprint()

// 当前列表对应的目录指纹。为空表示还没扫过，与任何目录都不匹配。
const scannedDirectories = ref('')

const applyCache = cached => {
  plugins.value = cached.plugins.map(plugin => ({
    path: plugin.path,
    details: { info: { name: plugin.name, vendor: plugin.vendor } },
  }))
  warnings.value = Array.isArray(cached.warnings) ? cached.warnings : []
  scanTime.value = cached.time || 0
  scannedDirectories.value = directoriesKey(cached.directories)
  scanned.value = true
}

// 同一面板只保留一个进行中的请求；令牌阻止卸载后的异步回写。
const scan = async() => {
  if (scanning.value) return
  const token = ++scanToken
  const scanDirectories = [...appSetting['player.vst3.directories']]
  scanning.value = true
  error.value = ''
  startProgressWatch()
  try {
    const result = await scanVst3Plugins(scanDirectories)
    if (token !== scanToken) return
    // 目录在扫描中改变时丢弃旧结果，收尾后按新目录重扫。
    if (directoriesKey(result.customDirectories) !== directoryFingerprint()) {
      scanned.value = false
      return
    }
    plugins.value = result.plugins
    warnings.value = result.warnings
    scanTime.value = Date.now()
    scannedDirectories.value = directoriesKey(result.customDirectories)
    scanned.value = true
    try {
      localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({
        version: 2,
        time: scanTime.value,
        warnings: result.warnings,
        directories: result.customDirectories,
        plugins: result.plugins.map(plugin => ({
          path: plugin.path,
          name: plugin.details.info.name,
          vendor: plugin.details.info.vendor,
        })),
      }))
    } catch {}
  } catch (err) {
    if (token === scanToken) error.value = cleanVst3Error(err)
  } finally {
    if (token === scanToken) {
      scanning.value = false
      stopProgressWatch()
      if (props.show && directoriesKey(scanDirectories) !== directoryFingerprint()) void scan()
    }
  }
}
watch([() => props.show, directoryFingerprint], ([show]) => {
  if (!show || scanning.value) return
  // 目录没变且已有结果，直接复用，不重复扫描。
  if (scanned.value && scannedDirectories.value === directoryFingerprint()) return
  try {
    const cached = JSON.parse(localStorage.getItem(SCAN_CACHE_KEY) ?? 'null')
    // 只有缓存记录的目录与当前设置一致才复用，否则用户改过自定义路径后
    // 面板会一直显示旧列表，看起来像自定义路径没生效。
    if (Array.isArray(cached?.plugins) && cacheMatchesDirectories(cached)) {
      applyCache(cached)
      return
    }
  } catch {}
  void scan()
})

const addPlugin = path => {
  error.value = ''
  if (chainFull.value) {
    error.value = 'VST3: maximum 16 plugins'
    return
  }
  // 与酷狗音效插件一致：添加后默认启用并立即生效。
  updateSetting({ 'player.vst3.chain': plainVst3Chain([...appSetting['player.vst3.chain'], { id: randomUUID(), path, enabled: true }]) })
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, .12);
}
.panel {
  position: absolute;
  right: 12px;
  bottom: @height-player + 10px;
  width: min(480px, calc(100vw - 28px));
  height: min(560px, calc(100vh - @height-player - 34px));
  display: flex;
  flex-direction: column;
  background: var(--color-content-background);
  color: var(--color-font);
  border: 1px solid var(--color-primary-light-400-alpha-700);
  border-radius: 6px;
  box-shadow: 0 5px 18px rgba(0, 0, 0, .22);
  overflow: hidden;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  box-sizing: border-box;
  padding: 8px 12px 8px 16px;
  background: var(--color-primary-light-100-alpha-100);
  border-bottom: 1px solid var(--color-primary-light-400-alpha-700);
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;

  svg {
    width: 20px;
    height: 20px;
    color: var(--color-primary);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
}
.count {
  min-width: 18px;
  height: 18px;
  box-sizing: border-box;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-primary-light-400-alpha-700);
  color: var(--color-primary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.headerActions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.iconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 6px;
  border: 0;
  border-radius: 4px;
  outline: 0;
  color: var(--color-button-font);
  background: transparent;
  cursor: pointer;
  transition: @transition-fast;
  transition-property: color, background-color, opacity;
  &:hover {
    color: var(--color-primary);
    background: var(--color-primary-light-400-alpha-700);
  }
  &:active {
    background: var(--color-primary-light-600-alpha-700);
  }
  &:disabled {
    cursor: default;
    opacity: .25;
    &:hover {
      color: var(--color-button-font);
      background: transparent;
    }
  }
  svg {
    width: 18px;
    height: 18px;
  }
}
.toolbar {
  box-sizing: border-box;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-primary-light-400-alpha-700);
  background: var(--color-primary-light-100-alpha-100);
}
.filterInput {
  width: 100%;
  height: 30px;
  box-sizing: border-box;
  padding: 0 9px;
  border: 1px solid var(--color-primary-light-400-alpha-700);
  border-radius: 4px;
  outline: none;
  color: var(--color-font);
  background: var(--color-content-background);
  &:focus {
    border-color: var(--color-primary);
  }
}
.current {
  flex: 1;
  min-height: 0;
}
.progress {
  padding: 20px 16px;
  text-align: center;
}
.progressTitle {
  margin: 0 0 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.progressTrack {
  position: relative;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--color-primary-light-400-alpha-700);
}
.progressBar {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary);
  transition: width .25s ease;
}
// 目录遍历阶段还不知道插件总数，无法给出百分比，用流动条表示仍在工作。
.progressBarIndeterminate {
  width: 35%;
  animation: vst3-progress-slide 1.1s ease-in-out infinite;
}
@keyframes vst3-progress-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
.progressPath {
  margin: 10px 0 0;
  font-size: 11px;
  opacity: .65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.progressHint {
  margin: 6px 0 0;
  font-size: 11px;
  opacity: .55;
}
.listScroll {
  height: 100%;
  overflow-y: auto;
  outline: none;
}
.item {
  width: 100%;
  height: 44px;
  box-sizing: border-box;
  padding: 0 6px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  transition: background-color @transition-fast;
  &:hover {
    background: var(--color-primary-light-400-alpha-700);
  }
}
.pluginName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.addBtn {
  border: 0;
  border-radius: 4px;
  min-width: 26px;
  height: 24px;
  padding: 2px 8px;
  color: var(--color-button-font);
  background: var(--color-button-background);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  flex: none;
  &:disabled {
    cursor: default;
    opacity: .4;
  }
}
.addedTag {
  flex: none;
  font-size: 11px;
  color: var(--color-primary);
  opacity: .8;
}
.empty {
  padding: 20px;
  text-align: center;
  opacity: .65;
}
.linkButton {
  border: 0;
  padding: 2px 4px;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  &:hover {
    text-decoration: underline;
  }
}
.footer {
  min-height: 30px;
  box-sizing: border-box;
  padding: 4px 12px;
  border-top: 1px solid var(--color-primary-light-400-alpha-700);

  p {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}
.error {
  color: var(--color-danger, #e2534d);
}
.warning {
  opacity: .65;
  overflow-wrap: anywhere;
}
</style>
