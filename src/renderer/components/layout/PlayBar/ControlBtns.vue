<template>
  <div :class="$style.controlBtn">
    <!-- <common-volume-bar /> -->
    <button :class="$style.titleBtn" :aria-label="$t('player__add_music_to')" @click="addMusicTo">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="90%" viewBox="0 0 512 512" space="preserve">
        <use xlink:href="#icon-add-2" />
      </svg>
    </button>
    <button :class="$style.titleBtn" :aria-label="toggleDesktopLyricBtnTitle" @click="toggleDesktopLyric" @contextmenu="toggleLockDesktopLyric">
      <svg v-show="appSetting['desktopLyric.enable']" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 512 512" space="preserve">
        <use xlink:href="#icon-desktop-lyric-on" />
      </svg>
      <svg v-show="!appSetting['desktopLyric.enable']" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 512 512" space="preserve">
        <use xlink:href="#icon-desktop-lyric-off" />
      </svg>
    </button>
    <common-volume-btn />
    <common-toggle-play-mode-btn />
    <button :class="[$style.titleBtn, $style.queueBtn, { [$style.active]: isShowQueue }]" :aria-label="$t('player__queue')" @click="isShowQueue = !isShowQueue">
      <svg :class="$style.queueIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="2 3 21 19" space="preserve">
        <use xlink:href="#icon-play-queue" />
      </svg>
    </button>
    <common-list-add-modal v-model:show="isShowAddMusicTo" :music-info="playMusicInfo.musicInfo" />
    <play-queue :show="isShowQueue" @close="isShowQueue = false" />
  </div>
</template>

<script>
import { ref } from '@common/utils/vueTools'
import useToggleDesktopLyric from '@renderer/utils/compositions/useToggleDesktopLyric'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import PlayQueue from './PlayQueue.vue'

export default {
  components: {
    PlayQueue,
  },
  setup() {
    const isShowAddMusicTo = ref(false)
    const isShowQueue = ref(false)
    const {
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
    } = useToggleDesktopLyric()
    const addMusicTo = () => {
      if (!musicInfo.id) return
      isShowAddMusicTo.value = true
    }
    return {
      appSetting,
      isShowAddMusicTo,
      isShowQueue,
      toggleDesktopLyricBtnTitle,
      toggleDesktopLyric,
      toggleLockDesktopLyric,
      addMusicTo,
      playMusicInfo,
    }
  },
}
</script>

<style lang="less" module>
.controlBtn { padding-left: 10px; flex: none; display: flex; align-items: center; gap: 10px; height: 25px;
  button { color: var(--ui-muted); }
}
.titleBtn { flex: none; display: flex; align-items: center; justify-content: center; width: 21px; height: 24px; border: 0; padding: 2px; border-radius: 6px; background: transparent; color: var(--ui-muted); cursor: pointer;
  svg { width: 100%; height: 100%; fill: currentColor; }
  &:hover { color: var(--color-primary-font); background: var(--ui-selected); }
  &.active { color: var(--color-primary-font); }
}
.queueIcon { width: 100%; height: 100%; }
.queueBtn { align-self: stretch; }
@media (max-width: 980px) { .controlBtn { gap: 7px; padding-left: 2px; } }
</style>
