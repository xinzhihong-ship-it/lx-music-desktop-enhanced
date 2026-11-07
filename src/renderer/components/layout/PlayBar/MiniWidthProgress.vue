<template>
  <div :class="$style.player">
    <div :class="$style.picContent" :aria-label="$t('player__pic_tip')" @contextmenu="handleToMusicLocation" @click="showPlayerDetail">
      <img v-if="musicInfo.pic" :src="musicInfo.pic" decoding="async" @error="imgError">
      <div v-else :class="$style.emptyPic">L<span>X</span></div>
    </div>
    <div :class="$style.infoContent">
      <div :class="$style.titleRow">
        <div :class="$style.title" :aria-label="title + $t('copy_tip')" @click="handleCopy(title)">
          {{ title }}
        </div>
        <play-quality-tag />
        <song-key-tag />
      </div>
      <div :class="$style.status">{{ statusText }}</div>
    </div>
    <!-- <div :class="$style.timeContainer">
      <div :class="$style.timeContent">
        <span>{{ nowPlayTimeStr }}</span>
        <span style="margin: 0 1px;">/</span>
        <span>{{ maxPlayTimeStr }}</span>
        <div :class="$style.progress">
          <common-progress-bar v-if="!isShowPlayerDetail" :class-name="$style.progressBar" :progress="progress" :handle-transition-end="handleTransitionEnd" :is-active-transition="isActiveTransition" />
        </div>
      </div>
    </div> -->
    <play-progress :class="$style.miniProgress" />
    <control-btns :class="$style.secondaryControls" />
    <div :class="$style.playBtnContent">
      <button type="button" :class="$style.playBtn" :aria-label="$t('player__prev')" @click="playPrev()">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-prevMusic" />
        </svg>
      </button>
      <button type="button" :class="$style.playBtn" :aria-label="isPlay ? $t('player__pause') : $t('player__play')" @click="togglePlay">
        <svg v-if="isPlay" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-pause" />
        </svg>
        <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-play" />
        </svg>
      </button>
      <button type="button" :class="$style.playBtn" :aria-label="$t('player__next')" @click="playNext()">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-nextMusic" />
        </svg>
      </button>
      <stop-btn />
    </div>
  </div>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import ControlBtns from './ControlBtns.vue'
import PlayProgress from './PlayProgress.vue'
import PlayQualityTag from './PlayQualityTag.vue'
import SongKeyTag from './SongKeyTag.vue'
import StopBtn from './StopBtn.vue'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'
// import { lyric } from '@renderer/core/share/lyric'
import {
  statusText,
  musicInfo,
  isShowPlayerDetail,
  isPlay,
  playInfo,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setMusicInfo,
  setShowPlayerDetail,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { togglePlay, playNext, playPrev } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'
import { formatMusicName } from '@renderer/utils'

export default {
  name: 'CorePlayBar',
  components: {
    ControlBtns,
    PlayProgress,
    PlayQualityTag,
    SongKeyTag,
    StopBtn,
  },
  setup() {
    const router = useRouter()

    const {
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
    } = usePlayProgress()

    const showPlayerDetail = () => {
      if (!playMusicInfo.musicInfo) return
      setShowPlayerDetail(true)
    }
    const handleCopy = (text) => {
      clipboardWriteText(text)
    }

    const imgError = () => {
      // console.log(e)
      setMusicInfo({ pic: null })
    }

    const handleToMusicLocation = () => {
      const listId = playMusicInfo.listId
      if (!listId || listId == LIST_IDS.DOWNLOAD || !playMusicInfo.musicInfo) return
      if (playInfo.playIndex == -1) return
      void router.push({
        path: '/list',
        query: {
          id: listId,
          scrollIndex: playInfo.playIndex,
        },
      })
    }

    const title = computed(() => {
      return musicInfo.name
        ? formatMusicName(appSetting['download.fileName'], musicInfo.name, musicInfo.singer)
        : ''
    })

    // onBeforeUnmount(() => {
    // window.eventHub.emit(eventPlayerNames.setTogglePlay)
    // })

    return {
      musicInfo,
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
      handleCopy,
      imgError,
      statusText,
      title,
      showPlayerDetail,
      isPlay,
      togglePlay,
      playNext,
      playPrev,
      handleToMusicLocation,
      isShowPlayerDetail,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.player { position: relative; height: @height-player; box-sizing: border-box; display: grid;
  grid-template-columns: 48px minmax(100px, 1fr) minmax(150px, 1.4fr) minmax(150px, 1.15fr);
  grid-template-rows: 30px 22px; align-content: center; align-items: center; column-gap: 14px;
  padding: 12px 24px; z-index: 2; border-top: 1px solid var(--ui-border); background: var(--ui-surface);
  * { box-sizing: border-box; }
}
.picContent { grid-column: 1; grid-row: 1 / 3; width: 48px; height: 48px; border: 0; padding: 0; display: flex; cursor: pointer; border-radius: 12px; overflow: hidden; background: var(--ui-selected);
  img { width: 100%; height: 100%; object-fit: cover; }
  &:hover { opacity: .8; }
}
.emptyPic { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; letter-spacing: -1px; color: var(--color-primary-font); span { padding-left: 1px; } }
.infoContent { grid-column: 2; grid-row: 1 / 3; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.titleRow { display: flex; align-items: center; min-width: 0; max-width: 100%; }
.title { flex: 0 1 auto; min-width: 0; font-size: 12px; font-weight: 600; color: var(--ui-text); .mixin-ellipsis-1(); }
.status { font-size: 10px; color: var(--ui-muted); min-height: 15px; max-width: 100%; .mixin-ellipsis-1(); }
.timeContent { grid-column: 3; grid-row: 2; width: 100%; min-width: 0; color: var(--ui-muted); font-size: 9px; font-variant-numeric: tabular-nums; display: flex; align-items: center; justify-content: center; }
.playBtnContent { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; gap: 16px; height: 30px; }
.playBtn { flex: none; width: 23px; height: 23px; padding: 3px; border: 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--ui-muted); border-radius: 50%; cursor: pointer;
  svg { width: 100%; height: 100%; fill: currentColor; }
  &:hover { color: var(--color-primary-font); background: var(--ui-selected); }
  &:nth-child(2) { width: 30px; height: 30px; padding: 7px; color: var(--ui-surface); background: var(--color-font); }
}
.secondaryControls { grid-column: 4; grid-row: 1 / 3; justify-self: end; }
.miniProgress { grid-column: 3; grid-row: 2; justify-self: center; }
@media (max-width: 980px) { .player { padding: 12px 14px; column-gap: 10px; } .playBtnContent { gap: 10px; } }

</style>
