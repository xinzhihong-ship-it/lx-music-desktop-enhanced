<template>
  <teleport to="#root">
    <transition name="fade">
      <div v-if="show" :class="$style.backdrop" @click.self="$emit('close')">
        <aside :class="$style.panel">
          <header :class="$style.header">
            <div :class="$style.title">
              <svg viewBox="0 0 24 24">
                <use xlink:href="#icon-play-queue" />
              </svg>
              <h2>{{ $t('player__queue') }}</h2>
              <span :class="$style.count">{{ queue.length }}</span>
            </div>
            <div :class="$style.headerActions">
              <button
                type="button"
                :class="$style.iconBtn"
                :disabled="currentIndex < 0"
                :aria-label="$t('player__queue_locate')"
                :title="$t('player__queue_locate')"
                @click="locateCurrent"
              >
                <svg viewBox="0 0 24 24">
                  <use xlink:href="#icon-locate-current" />
                </svg>
              </button>
              <button
                type="button"
                :class="$style.iconBtn"
                :aria-label="$t('close')"
                :title="$t('close')"
                @click="$emit('close')"
              >
                <svg viewBox="0 0 24 24">
                  <use xlink:href="#icon-close" />
                </svg>
              </button>
            </div>
          </header>
          <section :class="$style.current">
            <p v-if="!queue.length" :class="$style.empty">{{ $t('no_item') }}</p>
            <base-virtualized-list
              v-else
              ref="listRef"
              :list="queue"
              key-name="id"
              :item-height="52"
              :container-class="$style.queueScroll"
            >
              <template #default="{ item, index }">
                <button
                  type="button"
                  :class="[$style.item, index == currentIndex ? $style.active : null]"
                  :title="`${getInfo(item).name} - ${getInfo(item).singer}`"
                  @dblclick="playIndex(index)"
                >
                  <span :class="$style.index">
                    <svg v-if="index == currentIndex" viewBox="0 0 24 24">
                      <use xlink:href="#icon-audio-wave" />
                    </svg>
                    <template v-else>{{ index + 1 }}</template>
                  </span>
                  <span :class="$style.info">
                    <strong>{{ getInfo(item).name }}</strong>
                    <small>{{ getInfo(item).singer }}</small>
                  </span>
                  <span :class="$style.source">{{ getSourceName(item) }}</span>
                </button>
              </template>
            </base-virtualized-list>
          </section>
          <section v-if="tempPlayList.length" :class="$style.later">
            <header>
              <div :class="$style.laterTitle">
                <strong>{{ $t('list__play_later') }}</strong>
                <span :class="$style.count">{{ tempPlayList.length }}</span>
              </div>
              <button
                type="button"
                :class="$style.iconBtn"
                :aria-label="$t('player__queue_clear')"
                :title="$t('player__queue_clear')"
                @click="clearTempPlayeList"
              >
                <svg viewBox="0 0 512 512">
                  <use xlink:href="#icon-eraser" />
                </svg>
              </button>
            </header>
            <div class="scroll" :class="$style.laterList">
              <div v-for="(item, index) in tempPlayList" :key="`${item.musicInfo.id}_${index}`" :class="$style.laterItem">
                <span>{{ getInfo(item.musicInfo).name }} - {{ getInfo(item.musicInfo).singer }}</span>
                <button
                  type="button"
                  :class="$style.removeBtn"
                  :aria-label="$t('player__queue_remove')"
                  :title="$t('player__queue_remove')"
                  @click="removeTempPlayList(index)"
                >
                  <svg viewBox="0 0 24 24">
                    <use xlink:href="#icon-close" />
                  </svg>
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from '@common/utils/vueTools'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { getList, clearTempPlayeList, removeTempPlayList } from '@renderer/store/player/action'
import { playList } from '@renderer/core/player/action'
import { sourceNames } from '@renderer/store'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
})
defineEmits(['close'])

const listRef = ref(null)
const queue = computed(() => getList(playInfo.playerListId))
const currentIndex = computed(() => {
  if (!playMusicInfo.musicInfo || playMusicInfo.isTempPlay) return -1
  return queue.value.findIndex(item => item.id == playMusicInfo.musicInfo?.id)
})
const getInfo = item => 'progress' in item ? item.metadata.musicInfo : item
const getSourceName = item => sourceNames.value[getInfo(item).source] || getInfo(item).source
const locateCurrent = () => {
  if (currentIndex.value < 0) return
  listRef.value?.scrollToIndex(currentIndex.value, -104, true)
}
const playIndex = index => {
  if (!playInfo.playerListId) return
  playList(playInfo.playerListId, index)
}

watch(() => props.show, show => {
  if (show) void nextTick(locateCurrent)
})
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
  width: min(430px, calc(100vw - 28px));
  height: min(570px, calc(100vh - @height-player - 34px));
  display: flex;
  flex-direction: column;
  background: var(--color-content-background);
  color: var(--color-font);
  border: 1px solid var(--color-primary-light-400-alpha-700);
  border-radius: 6px;
  box-shadow: 0 5px 18px rgba(0, 0, 0, .22);
  overflow: hidden;
}
.header, .later header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  box-sizing: border-box;
  padding: 8px 12px 8px 16px;
  background: var(--color-primary-light-100-alpha-100);
  border-bottom: 1px solid var(--color-primary-light-400-alpha-700);
}
.title, .laterTitle, .headerActions {
  display: flex;
  align-items: center;
}
.title {
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
.laterTitle {
  gap: 7px;
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
  gap: 4px;
}
.iconBtn, .removeBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
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
}
.iconBtn {
  width: 30px;
  height: 30px;
  padding: 6px;
  border-radius: 4px;
  svg {
    width: 18px;
    height: 18px;
  }
}
.current { flex: 1; min-height: 0; }
.empty { padding: 20px; text-align: center; opacity: .65; }
.queueScroll {
  height: 100%;
  overflow-y: auto;
  outline: none;
}
.item {
  width: 100%;
  height: 52px;
  box-sizing: border-box;
  padding: 0 14px 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  transition: background-color @transition-fast;
  &:hover {
    background: var(--color-primary-light-400-alpha-700);
  }
}
.active {
  color: var(--color-primary);
  background: var(--color-primary-light-400-alpha-700);
  box-shadow: inset 3px 0 0 var(--color-primary);
}
.index {
  width: 30px;
  flex: none;
  text-align: center;
  opacity: .55;
  svg {
    width: 18px;
    height: 18px;
    vertical-align: middle;
  }
}
.active .index {
  opacity: 1;
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  strong, small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-size: 13px;
    font-weight: 600;
  }
  small {
    font-size: 11px;
    opacity: .58;
  }
}
.source {
  flex: none;
  max-width: 76px;
  overflow: hidden;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--color-font-label);
  background: var(--color-primary-light-400-alpha-700);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.later {
  max-height: 35%;
  border-top: 1px solid var(--color-primary-light-400-alpha-700);
  header {
    min-height: 40px;
    padding-top: 5px;
    padding-bottom: 5px;
    font-size: 12px;
  }
}
.laterList { max-height: 150px; }
.laterItem {
  min-height: 34px;
  padding: 0 10px 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  &:hover {
    background: var(--color-primary-light-400-alpha-700);
  }
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.removeBtn {
  width: 26px;
  height: 26px;
  flex: none;
  padding: 5px;
  border-radius: 3px;
  svg {
    width: 16px;
    height: 16px;
  }
}
</style>
