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
            <input v-model="filterText" :class="$style.filterInput" type="search" :placeholder="$t('list__search')">
            <div :class="$style.headerActions">
              <button
                v-if="canEditQueue"
                type="button"
                :class="$style.iconBtn"
                :disabled="!queue.length"
                :aria-label="$t('player__queue_clear_all')"
                :title="$t('player__queue_clear_all')"
                @click="clearQueue"
              >
                <svg viewBox="0 0 512 512">
                  <use xlink:href="#icon-eraser" />
                </svg>
              </button>
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
          <div v-if="canEditQueue" :class="$style.selectionToolbar">
            <button type="button" @click="selectAllQueue">{{ $t('list__select_all') }}</button>
            <button type="button" :disabled="!selectedQueueItems.length" @click="clearQueueSelection">{{ $t('list__select_none') }}</button>
            <span v-if="selectedQueueItems.length" :class="$style.selectionCount">{{ $t('list__selected_count', { count: selectedQueueItems.length }) }}</span>
            <button v-if="selectedQueueItems.length" type="button" @click="collectSelected">♡ {{ $t('list__collect') }}</button>
            <button v-if="selectedQueueItems.length" type="button" @click="removeSelected">× {{ $t('list__remove') }}</button>
          </div>
          <section :class="$style.current">
            <p v-if="!filteredQueue.length" :class="$style.empty">{{ $t('no_item') }}</p>
            <base-virtualized-list
              v-else
              ref="listRef"
              :list="filteredQueue"
              key-name="id"
              :item-height="52"
              :container-class="`${$style.queueScroll} music-list-scroll`"
            >
              <template #default="{ item, index }">
                <div
                  :class="[$style.item, getSourceIndex(index) == currentIndex ? $style.active : null, getSourceIndex(index) == locatedIndex ? 'selected' : null, isQueueSelected(item) ? $style.selected : null]"
                  :aria-selected="isQueueSelected(item)"
                >
                  <button
                    type="button"
                    :class="$style.itemBody"
                    :title="`${getInfo(item).name} - ${getInfo(item).singer}`"
                    @click="handleQueueSelect($event, getSourceIndex(index))"
                    @dblclick="playIndex(getSourceIndex(index))"
                  >
                    <span :class="$style.index">
                      <svg v-if="isQueueSelected(item)" viewBox="0 0 448 512">
                        <use xlink:href="#icon-check-true" />
                      </svg>
                      <svg v-else-if="getSourceIndex(index) == currentIndex" viewBox="0 0 24 24">
                        <use xlink:href="#icon-audio-wave" />
                      </svg>
                      <template v-else>{{ getSourceIndex(index) + 1 }}</template>
                    </span>
                    <span :class="$style.info">
                      <strong>{{ getInfo(item).name }}</strong>
                      <small>{{ getInfo(item).singer }}</small>
                    </span>
                    <span :class="$style.source">{{ getSourceName(item) }}</span>
                  </button>
                  <button
                    v-if="canEditQueue"
                    type="button"
                    :class="$style.iconBtn"
                    :aria-label="$t('player__queue_move_up')"
                    :title="$t('player__queue_move_up')"
                    :disabled="getSourceIndex(index) <= 0"
                    @click="moveQueueItem(getSourceIndex(index), -1)"
                  >↑</button>
                  <button
                    v-if="canEditQueue"
                    type="button"
                    :class="$style.iconBtn"
                    :aria-label="$t('player__queue_move_down')"
                    :title="$t('player__queue_move_down')"
                    :disabled="getSourceIndex(index) >= queue.length - 1"
                    @click="moveQueueItem(getSourceIndex(index), 1)"
                  >↓</button>
                  <button
                    type="button"
                    :class="$style.iconBtn"
                    :aria-label="$t('list__collect')"
                    :title="$t('list__collect')"
                    @click="collectQueueItem(getInfo(item))"
                  >♡</button>
                  <button
                    v-if="canEditQueue"
                    type="button"
                    :class="$style.removeBtn"
                    :aria-label="$t('player__queue_remove_item')"
                    :title="$t('player__queue_remove_item')"
                    @click="removeQueueItem(getSourceIndex(index))"
                  >
                    <svg viewBox="0 0 24 24">
                      <use xlink:href="#icon-close" />
                    </svg>
                  </button>
                </div>
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
            <div class="scroll music-list-scroll" :class="$style.laterList">
              <div v-for="(item, index) in tempPlayList" :key="`${item.musicInfo.id}_${index}`" :class="$style.laterItem">
                <span>{{ getInfo(item.musicInfo).name }} - {{ getInfo(item.musicInfo).singer }}</span>
                <button
                  type="button"
                  :class="$style.iconBtn"
                  :aria-label="$t('player__queue_move_up')"
                  :title="$t('player__queue_move_up')"
                  :disabled="index <= 0"
                  @click="moveTempPlayList(index, -1)"
                >↑</button>
                <button
                  type="button"
                  :class="$style.iconBtn"
                  :aria-label="$t('player__queue_move_down')"
                  :title="$t('player__queue_move_down')"
                  :disabled="index >= tempPlayList.length - 1"
                  @click="moveTempPlayList(index, 1)"
                >↓</button>
                <button
                  type="button"
                  :class="$style.iconBtn"
                  :aria-label="$t('list__collect')"
                  :title="$t('list__collect')"
                  @click="collectQueueItem(item.musicInfo)"
                >♡</button>
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
        <search-list :list="queueSearchList" :visible="isShowLocator" @action="handleLocatorAction" />
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { playInfo, playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { getList, clearTempPlayeList, removeTempPlayList } from '@renderer/store/player/action'
import { addListMusics, removeListMusics, clearListMusics, updateListMusicsPosition } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player/action'
import { sourceNames } from '@renderer/store'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { LIST_IDS } from '@common/constants'
import { loveList } from '@renderer/store/list/state'
import SearchList from '@renderer/views/List/MusicList/components/SearchList.vue'
import { filterMusicRows } from '@renderer/utils/filterMusicRows'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
})
defineEmits(['close'])

const t = useI18n()
const listRef = ref(null)
const filterText = ref('')
const selectedQueueItems = ref([])
let lastSelectedIndex = -1
const isShowLocator = ref(false)
const locatedIndex = ref(-1)
const listVersion = ref(0)
const handleListUpdate = () => {
  listVersion.value++
}
window.app_event.on('myListUpdate', handleListUpdate)
window.app_event.on('downloadListUpdate', handleListUpdate)
onBeforeUnmount(() => {
  window.app_event.off('myListUpdate', handleListUpdate)
  window.app_event.off('downloadListUpdate', handleListUpdate)
})
const queue = computed(() => {
  void listVersion.value
  return [...getList(playInfo.playerListId)]
})
const getInfo = item => 'progress' in item ? item.metadata.musicInfo : item
const queueSearchList = computed(() => queue.value.map(getInfo))
const filteredRows = computed(() => filterMusicRows(queue.value, filterText.value, getInfo))
const filteredQueue = computed(() => filteredRows.value.map(({ item }) => item))
const getSourceIndex = index => filteredRows.value[index]?.index ?? index
const currentIndex = computed(() => {
  if (!playMusicInfo.musicInfo || playMusicInfo.isTempPlay) return -1
  return queue.value.findIndex(item => item.id == playMusicInfo.musicInfo?.id)
})
const getSourceName = item => sourceNames.value[getInfo(item).source] || getInfo(item).source
const isQueueSelected = item => selectedQueueItems.value.some(selected => selected.id == getInfo(item).id)
const selectAllQueue = () => {
  selectedQueueItems.value = queue.value.map(getInfo)
  lastSelectedIndex = queue.value.length - 1
}
const clearQueueSelection = () => {
  selectedQueueItems.value = []
  lastSelectedIndex = -1
}
const handleQueueSelect = (event, index) => {
  if (!canEditQueue.value) return
  const item = queue.value[index]
  if (!item) return
  const info = getInfo(item)
  if (event.shiftKey && lastSelectedIndex > -1) {
    const start = Math.min(lastSelectedIndex, index)
    const end = Math.max(lastSelectedIndex, index)
    selectedQueueItems.value = queue.value.slice(start, end + 1).map(getInfo)
  } else if (event.metaKey || event.ctrlKey) {
    const selectedIndex = selectedQueueItems.value.findIndex(selected => selected.id == info.id)
    if (selectedIndex > -1) selectedQueueItems.value.splice(selectedIndex, 1)
    else selectedQueueItems.value.push(info)
    lastSelectedIndex = index
  } else if (selectedQueueItems.value.length) {
    selectedQueueItems.value = []
    lastSelectedIndex = index
  }
}
const collectSelected = () => {
  if (selectedQueueItems.value.length) void addListMusics(loveList.id, [...selectedQueueItems.value])
  clearQueueSelection()
}
const removeSelected = () => {
  if (!canEditQueue.value || !selectedQueueItems.value.length) return
  void removeListMusics({ listId: playInfo.playerListId, ids: selectedQueueItems.value.map(item => item.id) })
  clearQueueSelection()
}
const locateCurrent = () => {
  if (currentIndex.value < 0) return
  filterText.value = ''
  void nextTick(() => {
    listRef.value?.scrollToIndex(currentIndex.value, -104, true)
  })
}
const playIndex = index => {
  if (!playInfo.playerListId) return
  playList(playInfo.playerListId, index)
}
const canEditQueue = computed(() => !!playInfo.playerListId && playInfo.playerListId != LIST_IDS.DOWNLOAD)
const moveQueueItem = (index, delta) => {
  if (!canEditQueue.value) return
  const item = queue.value[index]
  const target = index + delta
  if (!item || target < 0 || target >= queue.value.length) return
  void updateListMusicsPosition({ listId: playInfo.playerListId, position: target, ids: [getInfo(item).id] })
}
const moveTempPlayList = (index, delta) => {
  const target = index + delta
  if (index < 0 || target < 0 || target >= tempPlayList.length) return
  const [item] = tempPlayList.splice(index, 1)
  tempPlayList.splice(target, 0, item)
}
const collectQueueItem = item => {
  if (item) void addListMusics(loveList.id, [item])
}
const removeQueueItem = index => {
  if (!canEditQueue.value) return
  const item = queue.value[index]
  if (!item) return
  void removeListMusics({ listId: playInfo.playerListId, ids: [getInfo(item).id] })
}
const clearQueue = async() => {
  if (!canEditQueue.value || !queue.value.length) return
  const confirm = await dialog.confirm({
    message: t('player__queue_clear_all_tip', { len: queue.value.length }),
    cancelButtonText: t('cancel_button_text_2'),
    confirmButtonText: t('confirm_button_text'),
  })
  if (!confirm) return
  void clearListMusics([playInfo.playerListId])
}
const handleShowLocator = () => {
  if (!props.show) return
  isShowLocator.value = true
}
const handleLocatorAction = ({ action, data }) => {
  isShowLocator.value = false
  if (action != 'listClick' || !data || data.index < 0) return
  filterText.value = ''
  void nextTick(() => {
    locatedIndex.value = data.index
    listRef.value?.scrollToIndex(data.index, -104, true)
    setTimeout(() => {
      locatedIndex.value = -1
    }, 600)
    if (data.isPlay) playIndex(data.index)
  })
}
window.key_event.on('key_mod+f_down', handleShowLocator)

watch(() => props.show, show => {
  if (show) void nextTick(locateCurrent)
  else isShowLocator.value = false
})
onBeforeUnmount(() => {
  window.key_event.off('key_mod+f_down', handleShowLocator)
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
.title, .laterTitle {
  display: flex;
  align-items: center;
  gap: 4px;
}
.selectionToolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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
.headerActions {
  display: flex;
  align-items: center;
  flex: none;
}
.filterInput {
  flex: 1;
  min-width: 80px;
  height: 30px;
  box-sizing: border-box;
  margin: 0 8px;
  padding: 0 9px;
  border: 1px solid var(--color-primary-light-400-alpha-700);
  border-radius: 4px;
  outline: none;
  color: var(--color-font);
  background: var(--color-content-background);
  &:focus {
    border-color: var(--color-primary);
  }
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
  padding-right: 6px;
  display: flex;
  align-items: center;
  color: inherit;
  transition: background-color @transition-fast;
  &:hover {
    background: var(--color-primary-light-400-alpha-700);
  }
}
.selected {
  background: var(--color-primary-light-400-alpha-700);
  box-shadow: inset 3px 0 0 var(--color-primary);
  .index {
    color: var(--color-primary);
    opacity: 1;
  }
  .info strong {
    color: var(--color-primary);
  }
}
.itemBody {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 8px 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
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
