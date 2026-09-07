<template>
  <button :class="$style.btn" :aria-label="$t('player__vst3_title')" :title="$t('player__vst3_title')" @click="visible = true">
    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="90%" viewBox="0 0 24 24" space="preserve">
      <use xlink:href="#icon-plugin" />
    </svg>
  </button>
  <teleport to="#root">
    <transition name="fade">
      <div v-if="visible" :class="$style.backdrop" @click.self="visible = false">
        <aside :class="$style.panel">
          <header :class="$style.header">
            <div :class="$style.title">
              <svg viewBox="0 0 24 24">
                <use xlink:href="#icon-plugin" />
              </svg>
              <h2>{{ $t('player__vst3_title') }}</h2>
              <span :class="$style.count">{{ chain.length }}</span>
            </div>
            <div :class="$style.headerActions">
              <button type="button" :class="$style.iconBtn" :aria-label="$t('close')" :title="$t('close')" @click="visible = false">
                <svg viewBox="0 0 24 24">
                  <use xlink:href="#icon-close" />
                </svg>
              </button>
            </div>
          </header>
          <div :class="$style.body">
            <p v-if="!supported" :class="$style.tip">{{ $t('player__vst3_engine_tip') }}</p>
            <template v-else>
              <div :class="$style.toolbar">
                <button type="button" :disabled="!chain.length" @click="toggleAll">{{ allEnabled ? $t('player__vst3_disable_all') : $t('player__vst3_enable_all') }}</button>
                <button type="button" @click="showPicker = true">{{ $t('player__vst3_picker_title') }}</button>
                <span v-if="runtime.active" :class="$style.latency">{{ $t('setting__vst3_latency') }} {{ runtime.latencyMs.toFixed(1) }} ms · {{ $t('setting__vst3_bridge') }} {{ runtime.bridgeMs.toFixed(1) }} ms</span>
              </div>
              <p :class="$style.tip">
                歌曲源：{{ runtime.readingSourceRate ? '读取中…' : runtime.sourceSampleRate ? (runtime.sourceSampleRate / 1000) + ' kHz' : '未知 / 未播放' }}
                <span v-if="runtime.active && runtime.sampleRate"> · 处理：{{ runtime.sampleRate / 1000 }} kHz</span>
              </p>
              <div :class="['scroll', $style.content]">
                <div v-if="!chain.length" :class="$style.empty">{{ $t('player__vst3_empty') }}</div>
                <ul v-if="chain.length" :class="$style.list">
                  <li v-for="(slot, index) in chain" :key="slot.id" :class="$style.item" :title="slot.path">
                    <base-checkbox :id="'vst3_slot_' + slot.id" :model-value="slot.enabled" :label="slotName(slot)" @update:model-value="toggleSlot(index, $event)" />
                    <span v-if="slotLatency(slot.id)" :class="$style.slotLatency">{{ slotLatency(slot.id) }} ms</span>
                    <span :class="$style.itemActions">
                      <button type="button" :class="$style.iconBtn" :disabled="index === 0" :aria-label="$t('setting__vst3_up') + ': ' + slotName(slot)" :title="$t('setting__vst3_up')" @click="moveSlot(index, index - 1)">↑</button>
                      <button type="button" :class="$style.iconBtn" :disabled="index === chain.length - 1" :aria-label="$t('setting__vst3_down') + ': ' + slotName(slot)" :title="$t('setting__vst3_down')" @click="moveSlot(index, index + 1)">↓</button>
                      <button type="button" :class="$style.iconBtn" :disabled="!slot.enabled || !runtime.active" :aria-label="$t('player__vst3_settings') + ': ' + slotName(slot)" :title="$t('player__vst3_settings')" @click="editor(slot.id, true)">
                        <svg viewBox="0 0 512 512"><use xlink:href="#icon-setting" /></svg>
                      </button>
                      <button type="button" :class="$style.iconBtn" :aria-label="$t('setting__vst3_remove_plugin') + ': ' + slotName(slot)" :title="$t('setting__vst3_remove_plugin')" @click="removeSlot(index)">
                        <svg viewBox="0 0 212.982 212.982"><use xlink:href="#icon-delete" /></svg>
                      </button>
                    </span>
                  </li>
                </ul>
              </div>
              <p v-if="runtime.notice" :class="$style.tip">{{ $t('player__vst3_bypass_notice') }}</p>
              <p v-if="runtime.error || error" role="alert" :class="$style.error">{{ error || runtime.error }}</p>
            </template>
          </div>
        </aside>
      </div>
    </transition>
  </teleport>
  <vst3-plugin-picker :show="showPicker" @close="showPicker = false" />
</template>

<script>
import { computed, ref, watch } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { openVst3Editor } from '@renderer/utils/ipc'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'
import { vst3Runtime, cleanVst3Error, plainVst3Chain, refreshVst3Status } from '@renderer/plugins/player/vst3'
import Vst3PluginPicker from './Vst3PluginPicker.vue'

export default {
  components: {
    Vst3PluginPicker,
  },
  setup() {
    const visible = ref(false)
    const showPicker = ref(false)
    const error = ref('')

    const chain = computed(() => appSetting['player.vst3.chain'])
    const supported = computed(() => appSetting['player.playEngine'] === 'electron' && !isBiliVideoActive())
    const allEnabled = computed(() => chain.value.length > 0 && chain.value.every(slot => slot.enabled))
    const runtime = vst3Runtime

    const slotName = slot => slot.info?.name ?? slot.path.split(/[\\/]/).pop().replace(/\.vst3$/i, '')
    const slotLatency = id => {
      const slot = vst3Runtime.slots.find(slot => slot.id === id)
      return slot && slot.latencyMs >= 0.5 ? Math.round(slot.latencyMs) : 0
    }
    watch(visible, value => {
      if (value) void refreshVst3Status()
    })
    const setChain = targets => { updateSetting({ 'player.vst3.chain': plainVst3Chain(targets) }) }

    const toggleSlot = (index, enabled) => {
      setChain(chain.value.map((slot, i) => i === index ? { ...slot, enabled } : slot))
    }
    // 对齐酷狗音效插件：列表批量开关，全部关闭后恢复直通输出。
    const toggleAll = () => {
      const enabled = !allEnabled.value
      setChain(chain.value.map(slot => ({ ...slot, enabled })))
    }
    const removeSlot = index => {
      setChain(chain.value.filter((_, i) => i !== index))
    }
    const moveSlot = (from, to) => {
      const targets = [...chain.value]
      if (to < 0 || to >= targets.length) return
      targets.splice(to, 0, targets.splice(from, 1)[0])
      setChain(targets)
    }
    const editor = async(id, open) => {
      error.value = ''
      try { await openVst3Editor({ id, open }) } catch (err) { error.value = cleanVst3Error(err) }
    }

    return {
      visible,
      showPicker,
      chain,
      error,
      supported,
      allEnabled,
      runtime,
      slotName,
      slotLatency,
      toggleSlot,
      toggleAll,
      removeSlot,
      moveSlot,
      editor,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btn {
  position: relative;
  justify-content: center;
  align-items: center;
  transition: color @transition-normal;
  cursor: pointer;
  background-color: transparent;
  border: none;
  width: 24px;
  display: flex;
  flex-flow: column nowrap;
  padding: 0;

  svg {
    transition: opacity @transition-fast;
    opacity: .6;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    svg {
      opacity: .9;
    }
  }
  &:active {
    svg {
      opacity: 1;
    }
  }
}

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
  width: min(430px, calc(100vw - 28px));
  height: min(480px, calc(100vh - @height-player - 34px));
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
  font-size: 14px;
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
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  min-height: 38px;
  box-sizing: border-box;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-primary-light-400-alpha-700);
  background: var(--color-primary-light-100-alpha-100);

  button {
    border: 0;
    border-radius: 4px;
    min-width: 26px;
    height: 24px;
    padding: 2px 6px;
    color: var(--color-button-font);
    background: var(--color-button-background);
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
    &:disabled {
      cursor: default;
      opacity: .4;
    }
  }
}
.latency {
  font-size: 11px;
  opacity: .65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline: none;
}
.empty {
  padding: 20px;
  text-align: center;
  opacity: .65;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  width: 100%;
  min-height: 46px;
  box-sizing: border-box;
  padding: 4px 6px 4px 12px;
  display: flex;
  align-items: center;
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
.slotLatency {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
}
.itemActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
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
  &:disabled {
    cursor: default;
    opacity: .4;
  }
}
.subTitle {
  margin: 0;
  padding: 10px 12px 4px;
  font-size: 12px;
  font-weight: 600;
  opacity: .65;
}
.warnings {
  padding: 6px 12px;
}
.warning {
  font-size: 11px;
  opacity: .65;
  padding: 2px 0;
  word-break: break-all;
}
.tip {
  padding: 16px;
  font-size: 12px;
  line-height: 1.4;
  opacity: .65;
}
.error {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color-danger, #e2534d);
  border-top: 1px solid var(--color-primary-light-400-alpha-700);
}

</style>
