<template>
  <div v-if="!doc.lines.length" :class="$style.empty">
    <p>{{ $t('lyric_view__empty') }}</p>
    <base-btn min @click.stop="$emit('search')">{{ $t('lyric_menu__search') }}</base-btn>
  </div>
  <StageView
    v-else :doc="doc" :style-name="styleName" :sparks="sparks" :accent="accent"
    :read-position="readLyricPosition" :playing="isPlay" :roma-first="isRomaFirst" :font-scale="fontScale"
  />
</template>

<script setup>
// 播放详情页的歌词舞台：空歌词时提示搜索；舞台本体（StageView）与桌面歌词共用
import { computed } from '@common/utils/vueTools'
import { isRomaFirst, readLyricPosition } from '@renderer/core/lyrics/engine'
import { isPlay } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import StageView from './StageView.vue'

defineProps({
  doc: { type: Object, required: true },
  styleName: { type: String, default: 'flow' },
  sparks: { type: Boolean, default: false },
  accent: { type: String, default: 'var(--color-primary)' },
})
defineEmits(['search'])

const fontScale = computed(() => (appSetting['playDetail.style.fontSize'] ?? 140) / 140)
</script>

<style lang="less" module>
.empty {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  font-size: 15px;
  color: var(--color-font-label);
}
</style>
