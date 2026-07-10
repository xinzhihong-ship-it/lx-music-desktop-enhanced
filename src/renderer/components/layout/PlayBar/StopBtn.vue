<template>
  <div v-if="isMac && appSetting['player.playEngine'] === 'audirvana'" :class="$style.playBtn" :aria-label="$t('player__audirvana_stop')" @click="handleStop">
    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
      <rect x="256" y="256" width="512" height="512" rx="80" ry="80" />
    </svg>
  </div>
</template>

<script>
import { isMac } from '@common/utils'
import { appSetting } from '@renderer/store/setting'
import { stop } from '@renderer/core/player'

export default {
  setup() {
    const handleStop = () => {
      stop()
    }
    return {
      isMac,
      appSetting,
      handleStop,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.playBtn {
  flex: none;
  height: 100%;
  width: 24px;
  transition: @transition-fast;
  transition-property: color, opacity;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  opacity: .6;

  svg {
    fill: currentColor;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    opacity: 1;
  }
  &:active {
    opacity: 1;
  }
}
</style>
