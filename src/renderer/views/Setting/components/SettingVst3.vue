<template lang="pug">
dd
  div(:class="$style.vst3Section")
    h3#basic_play_vst3 VST3
    p(:class="$style.formDesc") {{ $t('setting__vst3_development') }}
    .gap-top
      base-checkbox(id="setting_vst3_enable" :disabled="appSetting['player.playEngine'] !== 'electron'" :model-value="appSetting['player.vst3.enabled']" :label="$t('setting__vst3_enable')" @update:model-value="updateSetting({ 'player.vst3.enabled': $event })")
    .gap-top
      span(:class="$style.latencyText") {{ $t('setting__vst3_latency') }}: {{ runtime.latencyMs.toFixed(1) }} ms / {{ $t('setting__vst3_bridge') }}: {{ runtime.bridgeMs.toFixed(1) }} ms
    p(v-if="runtime.notice" :class="$style.formDesc") {{ $t('player__vst3_bypass_notice') }}
    p(v-if="runtime.error" role="alert" :class="$style.errorText") {{ runtime.error }}
    p(v-if="error" role="alert" :class="$style.errorText") {{ error }}
    .gap-top(:class="$style.actionRow")
      base-btn(min @click="showPicker = true") {{ $t('player__vst3_picker_title') }}
      base-btn(min @click="addDirectory") {{ $t('setting__vst3_add') }}
    ul(v-if="appSetting['player.vst3.directories'].length" :class="$style.itemList")
      li(v-for="directory in appSetting['player.vst3.directories']" :key="directory" :class="$style.listItem")
        span(:class="$style.itemPath") {{ directory }}
        button(type="button" :class="$style.iconTextButton" :aria-label="$t('setting__vst3_remove') + ': ' + directory" :title="$t('setting__vst3_remove')" @click="removeDirectory(directory)") ✕
    div(v-if="appSetting['player.vst3.chain'].length")
      h4(:class="$style.subTitle") {{ $t('player__vst3_title') }}
      ul(:class="$style.itemList")
        li(v-for="(slot, index) in appSetting['player.vst3.chain']" :key="slot.id" :class="$style.listItem" :title="slot.path")
          base-checkbox(:id="'vst3_' + slot.id" :model-value="slot.enabled" :label="slotName(slot)" @update:model-value="toggleSlot(index, $event)")
          span(v-if="slotLatency(slot.id)" :class="$style.slotLatency") {{ slotLatency(slot.id) }} ms
          span(:class="$style.chainActions")
            button(type="button" :class="$style.iconTextButton" :disabled="index === 0" :aria-label="$t('setting__vst3_up') + ': ' + slotName(slot)" :title="$t('setting__vst3_up')" @click="moveSlot(index, index - 1)") ↑
            button(type="button" :class="$style.iconTextButton" :disabled="index === appSetting['player.vst3.chain'].length - 1" :aria-label="$t('setting__vst3_down') + ': ' + slotName(slot)" :title="$t('setting__vst3_down')" @click="moveSlot(index, index + 1)") ↓
            base-btn(min :disabled="!slot.enabled || !runtime.active" @click="editor(slot.id, true)") {{ $t('player__vst3_settings') }}
            button(type="button" :class="$style.iconTextButton" :aria-label="$t('setting__vst3_remove_plugin') + ': ' + slotName(slot)" :title="$t('setting__vst3_remove_plugin')" @click="removeSlot(index)") ✕
  vst3-plugin-picker(:show="showPicker" @close="showPicker = false")
</template>

<script>
import { ref } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { openVst3Editor, showSelectDialog } from '@renderer/utils/ipc'
import { vst3Runtime, cleanVst3Error, plainVst3Chain, refreshVst3Status } from '@renderer/plugins/player/vst3'
import Vst3PluginPicker from '@renderer/components/common/Vst3PluginPicker.vue'

export default {
  components: {
    Vst3PluginPicker,
  },
  setup() {
    const showPicker = ref(false)
    const error = ref('')
    const runtime = vst3Runtime

    const slotName = slot => slot.info?.name ?? slot.path.split(/[\\/]/).pop().replace(/\.vst3$/i, '')
    const slotLatency = id => {
      const slot = vst3Runtime.slots.find(slot => slot.id === id)
      return slot && slot.latencyMs >= 0.5 ? Math.round(slot.latencyMs) : 0
    }
    void refreshVst3Status()
    const setChain = chain => { updateSetting({ 'player.vst3.chain': plainVst3Chain(chain) }) }

    const addDirectory = async() => {
      error.value = ''
      try {
        const result = await showSelectDialog({ properties: ['openDirectory', 'multiSelections'] })
        if (result.canceled) return
        const directories = [...new Set([...appSetting['player.vst3.directories'], ...result.filePaths])]
        if (directories.length > 128) throw new Error('VST3: maximum 128 directories')
        updateSetting({ 'player.vst3.directories': directories })
      } catch (err) { error.value = cleanVst3Error(err) }
    }
    const removeDirectory = directory => {
      updateSetting({ 'player.vst3.directories': appSetting['player.vst3.directories'].filter(item => item !== directory) })
    }
    const toggleSlot = (index, enabled) => { setChain(appSetting['player.vst3.chain'].map((slot, i) => i === index ? { ...slot, enabled } : slot)) }
    const removeSlot = index => { setChain(appSetting['player.vst3.chain'].filter((_, i) => i !== index)) }
    const moveSlot = (from, to) => {
      const chain = [...appSetting['player.vst3.chain']]
      if (to < 0 || to >= chain.length) return
      chain.splice(to, 0, chain.splice(from, 1)[0])
      setChain(chain)
    }
    const editor = async(id, open) => {
      error.value = ''
      try { await openVst3Editor({ id, open }) } catch (err) { error.value = cleanVst3Error(err) }
    }
    return { appSetting, updateSetting, runtime, showPicker, error, slotName, slotLatency, addDirectory, removeDirectory, toggleSlot, removeSlot, moveSlot, editor }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.formDesc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
}
.latencyText {
  font-size: 12px;
  color: var(--color-font-label);
}
.errorText {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-danger, #e2534d);
  overflow-wrap: anywhere;
}
.actionRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.subTitle {
  margin: 14px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-button-font);
}
.itemList {
  max-width: 520px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.listItem {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: @form-radius;
  background-color: var(--color-primary-background);
}
.itemPath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chainActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.slotLatency {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
}
.iconTextButton {
  border: 0;
  color: var(--color-button-font);
  background: transparent;
  cursor: pointer;
  padding: 2px 4px;
  &:disabled {
    cursor: default;
    opacity: .35;
  }
}
.warnings .warningItem {
  display: block;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
