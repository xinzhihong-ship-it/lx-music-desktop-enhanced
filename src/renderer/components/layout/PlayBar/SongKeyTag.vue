<template>
  <span
    v-if="label"
    :class="[$style.keyTag, { [$style.custom]: isCustom, [$style.database]: isDatabase }]"
    :title="tooltipText"
    @click.stop="handleClick"
    @dblclick.stop="handleDblClick"
  >
    🎵 {{ label }}
  </span>
  <span
    v-else-if="isKeyAnalyzing && musicInfo.id"
    :class="[$style.keyTag, $style.analyzing]"
    title="正在分析这首歌的基调，请稍候"
  >
    分析中…
  </span>
  <song-key-modal v-model="showModal" />
</template>

<script>
import { ref, computed } from '@common/utils/vueTools'
import { musicInfo } from '@renderer/store/player/state'
import {
  effectiveSongKey,
  songKeyInfo,
  isKeyAnalyzing,
  playbackSeconds,
  isNativeWindowActive,
  openIndependentSongKeyWindow,
  updateCurrentSongKey,
} from '@renderer/store/player/songKey'
import SongKeyModal from './SongKeyModal.vue'

export default {
  components: {
    SongKeyModal,
  },
  setup() {
    const showModal = ref(false)

    const label = computed(() => {
      if (!musicInfo.id) return ''
      return effectiveSongKey.value?.label ?? ''
    })

    const isCustom = computed(() => songKeyInfo.value?.source === 'user')
    const isDatabase = computed(() => songKeyInfo.value?.source === 'database')

    const tooltipText = computed(() => {
      if (!songKeyInfo.value) return '点击设置基调'
      const source = isCustom.value ? '已记忆基调' : isDatabase.value ? '经典谱库' : '音频分析'
      const camelot = effectiveSongKey.value?.camelot ? ` (Camelot ${effectiveSongKey.value.camelot})` : ''
      const confidence = songKeyInfo.value?.source === 'analysis' && songKeyInfo.value.confidence
        ? ` · 置信度 ${Math.round(songKeyInfo.value.confidence * 100)}%`
        : ''
      // 有时间轴说明这首歌中途转调，标出当前在第几段
      const timeline = songKeyInfo.value?.timeline
      let modulation = ''
      if (timeline && timeline.length > 1) {
        const index = timeline.filter(segment => segment.at <= playbackSeconds.value).length
        modulation = ` · 全程 ${timeline.length} 段调性，当前第 ${Math.max(1, index)} 段`
      }
      return `${effectiveSongKey.value?.label}${camelot} · 来源: ${source}${confidence}${modulation} (单击设置，双击强制重新分析)`
    })

    let clickTimer = null

    const handleClick = () => {
      if (clickTimer) {
        clearTimeout(clickTimer)
        clickTimer = null
        return
      }
      clickTimer = setTimeout(() => {
        clickTimer = null
        if (isNativeWindowActive.value) {
          openIndependentSongKeyWindow()
        } else {
          showModal.value = true
        }
      }, 250)
    }

    const handleDblClick = () => {
      if (clickTimer) {
        clearTimeout(clickTimer)
        clickTimer = null
      }
      void updateCurrentSongKey(true)
    }

    return {
      showModal,
      label,
      isCustom,
      isDatabase,
      isKeyAnalyzing,
      musicInfo,
      tooltipText,
      handleClick,
      handleDblClick,
    }
  },
}
</script>

<style lang="less" module>
.keyTag {
  flex: none;
  box-sizing: border-box;
  margin-left: 6px;
  padding: 0 6px;
  height: 16px;
  line-height: 14px;
  border-radius: 3px;
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  // 默认 = 智能分析：算法估出来的，不一定准，用灰字 + 虚线框表达"存疑"
  color: var(--color-font-label);
  background-color: var(--color-primary-light-900-alpha-200);
  border: 1px dashed var(--color-font-label);

  &:hover {
    background-color: var(--color-primary-light-800-alpha-300);
  }

  // 经典谱库：已收录的确定值，主题色 + 实线框
  &.database {
    color: var(--color-primary);
    border: 1px solid var(--color-primary-alpha-400);
  }

  // 用户手动记忆：最确定，实心主题色
  &.custom {
    color: #fff;
    background-color: var(--color-primary);
    border: 1px solid transparent;

    &:hover {
      background-color: var(--color-primary-alpha-900);
    }
  }

  // 分析中：无边框、不可点，只是个状态提示
  &.analyzing {
    cursor: default;
    color: var(--color-font-label);
    border: 1px solid transparent;
    background-color: transparent;
  }
}
</style>
