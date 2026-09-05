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
            <p v-if="scanning" :class="$style.empty">{{ $t('setting__vst3_scanning') }}</p>
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
import { computed, ref, watch } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { scanVst3Plugins } from '@renderer/utils/ipc'
import { randomUUID } from 'node:crypto'
import { cleanVst3Error, plainVst3Chain } from '@renderer/plugins/player/vst3'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
})
defineEmits(['close'])

// 扫描结果全应用共享，重开面板与设置页复用，无需重复扫描。
const plugins = ref([])
const warnings = ref([])
const scanning = ref(false)
const error = ref('')
const filterText = ref('')
const scanned = ref(false)
const scanTime = ref(0)

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

// 扫描结果持久化到 localStorage，应用重启后仍有效；只有用户手动刷新才重新扫描。
const SCAN_CACHE_KEY = 'lx_vst3_scan_cache'

const applyCache = cached => {
  plugins.value = cached.plugins.map(plugin => ({
    path: plugin.path,
    details: { info: { name: plugin.name, vendor: plugin.vendor } },
  }))
  warnings.value = Array.isArray(cached.warnings) ? cached.warnings : []
  scanTime.value = cached.time || 0
  scanned.value = true
}

const scan = async() => {
  scanning.value = true
  error.value = ''
  try {
    const result = await scanVst3Plugins()
    plugins.value = result.plugins
    warnings.value = result.warnings
    scanTime.value = Date.now()
    scanned.value = true
    try {
      localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({
        time: scanTime.value,
        warnings: result.warnings,
        plugins: result.plugins.map(plugin => ({
          path: plugin.path,
          name: plugin.details.info.name,
          vendor: plugin.details.info.vendor,
        })),
      }))
    } catch {}
  } catch (err) {
    error.value = cleanVst3Error(err)
  } finally {
    scanning.value = false
  }
}
watch(() => props.show, show => {
  if (!show || scanned.value) return
  try {
    const cached = JSON.parse(localStorage.getItem(SCAN_CACHE_KEY) ?? 'null')
    if (Array.isArray(cached?.plugins)) {
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
