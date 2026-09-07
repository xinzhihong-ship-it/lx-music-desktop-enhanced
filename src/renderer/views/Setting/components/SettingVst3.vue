<template lang="pug">
dd
  div(:class="$style.vst3Section")
    h3#basic_play_vst3 VST3
    p(:class="$style.formDesc") {{ $t('setting__vst3_development') }}
    .gap-top
      base-checkbox(id="setting_vst3_enable" :disabled="appSetting['player.playEngine'] !== 'electron'" :model-value="appSetting['player.vst3.enabled']" :label="$t('setting__vst3_enable')" @update:model-value="updateSetting({ 'player.vst3.enabled': $event })")
    .gap-top
      span(:class="$style.latencyText") {{ $t('setting__vst3_latency') }}: {{ runtime.latencyMs.toFixed(1) }} ms / {{ $t('setting__vst3_bridge') }}: {{ runtime.bridgeMs.toFixed(1) }} ms
    .gap-top
      label(for="vst3-buffer") VST3 桥接缓冲（帧）：
      select#vst3-buffer(:value="appSetting['player.vst3.bufferFrames']" @change="updateSetting({ 'player.vst3.bufferFrames': Number($event.target.value) })")
        option(v-for="frames in [1024, 2048, 4096, 8192, 16384]" :key="frames" :value="frames") {{ frames }}{{ frames === 4096 ? '（推荐）' : '' }}
    .gap-top
      label(for="audio-sample-rate") 音频处理采样率：
      select#audio-sample-rate(:value="appSetting['player.audioSampleRate']" @change="updateSetting({ 'player.audioSampleRate': Number($event.target.value) })")
        option(:value="0") 系统默认（非跟随歌曲）
        option(v-for="rate in [44100, 48000, 88200, 96000, 176400, 192000]" :key="rate" :value="rate") {{ rate / 1000 }} kHz
    p(:class="$style.formDesc") 修改后即时应用，无需重启。切换时可能短暂静音；失败保留旧采样率并显示错误。缓冲越大，延迟和调度余量越大；高采样率更耗资源，不会提升音源原始质量。仅作用于内置引擎音效链，系统最终输出仍可能重采样。
    p(:class="$style.formDesc") 当前歌曲源采样率：{{ runtime.readingSourceRate ? '读取中…' : runtime.sourceSampleRate ? (runtime.sourceSampleRate / 1000) + ' kHz' : '未知 / 未播放' }}
    p(v-if="runtime.switchingRate" :class="$style.formDesc" role="status") 正在切换采样率…
    p(v-else-if="runtime.sampleRate" :class="$style.formDesc") 当前音频链：{{ runtime.sampleRate / 1000 }} kHz
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
