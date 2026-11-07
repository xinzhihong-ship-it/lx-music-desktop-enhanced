<template>
  <div :class="['right', $style.right]" :style="fontSizeVar" @contextmenu.stop="handleShowMenu">
    <!-- 一条工具栏：显示方式（滚动 + 三种舞台风格）| 火花 | 封面色背景，所有按钮同高同形 -->
    <div :class="$style.toolbar" role="toolbar" :aria-label="$t('lyric_view__toolbar')">
      <div :class="$style.group" role="radiogroup">
        <button
          v-for="item in modeOptions" :key="item.id" type="button" role="radio"
          :class="[$style.btn, { [$style.on]: mode == item.id }]" :aria-checked="mode == item.id"
          @click="setMode(item.id)"
        >{{ item.label }}</button>
      </div>
      <i :class="$style.divider" />
      <button
        type="button" :class="[$style.btn, { [$style.on]: wordByWord }]" :aria-pressed="wordByWord"
        :title="$t('lyric_view__word_tip')" @click="toggleWordByWord"
      >{{ $t('lyric_view__word') }}</button>
      <button
        type="button" :class="[$style.btn, { [$style.on]: sparks && view == 'stage' }]" :aria-pressed="sparks"
        :disabled="view != 'stage'" :title="$t('lyric_view__sparks_tip')" @click="toggleSparks"
      >{{ $t('lyric_view__sparks') }}</button>
      <button type="button" :class="[$style.btn, { [$style.on]: background == 'cover' }]" :aria-pressed="background == 'cover'" @click="toggleBackground">{{ $t('lyric_view__bg_cover') }}</button>
    </div>

    <LyricStage v-if="view == 'stage'" :doc="lyricDoc" :style-name="stageStyle" :sparks="sparks" :accent="accent" @search="isShowSearch = true" />
    <LyricScroll v-else :doc="lyricDoc" @search="isShowSearch = true" />

    <LyricMenu v-model="menuVisible" :xy="menuXY" :lyric-info="lyricInfo" @search="isShowSearch = true" />
    <LyricSearchModal v-model:show="isShowSearch" :music-info="playMusicInfo.musicInfo" />
  </div>
</template>

<script setup>
// 播放详情页右侧的歌词区：滚动歌词 / 舞台两种视图，右键菜单（字号、偏移、搜索歌词），搜索面板。
import { computed, nextTick, reactive, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { isFullscreen } from '@renderer/store'
import { isShowPlayComment, musicInfo as playerMusicInfo, playMusicInfo } from '@renderer/store/player/state'
import { lyricDoc } from '@renderer/core/lyrics/engine'
import LyricScroll from './LyricScroll.vue'
import LyricStage from './LyricStage.vue'
import LyricMenu from '../components/LyricMenu.vue'
import LyricSearchModal from '../components/LyricSearchModal.vue'

const props = defineProps({
  /** 封面主色背景下的强调色；跟随主题时用主题色 */
  accent: { type: String, default: '' },
})
const t = useI18n()

const view = computed(() => appSetting['playDetail.lyricView'] ?? 'scroll')
const stageStyle = computed(() => appSetting['playDetail.stageStyle'] ?? 'flow')
const sparks = computed(() => !!appSetting['playDetail.stageSparks'])
const background = computed(() => appSetting['playDetail.background'] ?? 'theme')
const accent = computed(() => props.accent || 'var(--color-primary)')

// 滚动歌词与三种舞台风格合成一组：scroll / flow / steps / tilt
const mode = computed(() => view.value == 'stage' ? stageStyle.value : 'scroll')
const modeOptions = computed(() => [
  { id: 'scroll', label: t('lyric_view__scroll') },
  { id: 'flow', label: t('lyric_view__style_flow') },
  { id: 'steps', label: t('lyric_view__style_steps') },
  { id: 'tilt', label: t('lyric_view__style_tilt') },
])
const setMode = id => {
  if (id == 'scroll') {
    if (view.value != 'scroll') updateSetting({ 'playDetail.lyricView': 'scroll' })
    return
  }
  const patch = {}
  if (view.value != 'stage') patch['playDetail.lyricView'] = 'stage'
  if (stageStyle.value != id) patch['playDetail.stageStyle'] = id
  if (Object.keys(patch).length) updateSetting(patch)
}
const wordByWord = computed(() => appSetting['player.lyricHighlight'] != 'line')
const toggleWordByWord = () => { updateSetting({ 'player.lyricHighlight': wordByWord.value ? 'line' : 'word' }) }
const toggleSparks = () => { updateSetting({ 'playDetail.stageSparks': !sparks.value }) }
const toggleBackground = () => { updateSetting({ 'playDetail.background': background.value == 'cover' ? 'theme' : 'cover' }) }

const fontSizeVar = computed(() => {
  let size = (appSetting['playDetail.style.fontSize'] ?? 140) / 100
  if (isFullscreen.value) size *= 1.4
  return { '--playDetail-lrc-font-size': `${isShowPlayComment.value ? size * 0.82 : size}rem` }
})

// ---- 右键菜单（沿用原有的字号 / 偏移 / 搜索） ----
const isShowSearch = ref(false)
const menuVisible = ref(false)
const menuXY = reactive({ x: 0, y: 0 })
const lyricInfo = reactive({ lyric: '', tlyric: '', rlyric: '', lxlyric: '', rawlyric: '', musicInfo: null })
const handleShowMenu = event => {
  // 歌词还没加载完时这些字段可能是 null，菜单会对它们做正则匹配
  lyricInfo.lyric = playerMusicInfo.lrc ?? ''
  lyricInfo.tlyric = playerMusicInfo.tlrc ?? ''
  lyricInfo.rlyric = playerMusicInfo.rlrc ?? ''
  lyricInfo.lxlyric = playerMusicInfo.lxlrc ?? ''
  lyricInfo.rawlyric = playerMusicInfo.rawlrc ?? ''
  lyricInfo.musicInfo = playMusicInfo.musicInfo
  menuXY.x = event.pageX
  menuXY.y = event.pageY
  if (menuVisible.value) return
  void nextTick(() => { menuVisible.value = true })
}
</script>

<style lang="less" module>
.right {
  // 只收缩不伸展：左栏 40% + 间距 + 60% 会超出（固定 60% 时右侧被裁掉）；打开评论时页面把它压到 30%，不能再撑开
  flex: 0 1 60%;
  position: relative;
  min-width: 0;
  transition: flex-basis .3s ease;
  &:hover .toolbar, .toolbar:focus-within {
    opacity: 1;
  }
}
.toolbar {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 15px;
  background-color: var(--color-primary-alpha-900);
  opacity: 0;
  transition: opacity .2s ease;
}
.group {
  display: flex;
  gap: 2px;
}
.divider {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background-color: var(--color-font-label);
  opacity: .3;
}
.btn {
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 12px;
  background: none;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 24px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color .2s ease, color .2s ease, opacity .2s ease;
  &:hover:not(:disabled) {
    color: var(--color-font);
  }
  &.on {
    color: var(--color-font);
    background-color: var(--color-primary-alpha-700);
  }
  &:disabled {
    opacity: .4;
    cursor: default;
  }
}
</style>
