<template>
  <div :class="$style.download">
    <div :class="$style.header">
      <base-tab v-model="activeTab" :class="$style.tab" :list="tabs" />
      <div v-if="activeTab == 'conversion'" :class="$style.convertTools">
        <base-selection :model-value="convertFormat" :list="convertFormats" item-key="id" item-name="name" @change="convertFormat = $event.id" />
        <base-checkbox id="download_convert_delete_source" :model-value="deleteConvertSource" :label="$t('conversion__delete_source')" @update:model-value="deleteConvertSource = $event" />
        <base-btn min @click="handleAddConversionFiles">{{ $t('conversion__add_files') }}</base-btn>
      </div>
    </div>
    <div v-if="activeTab != 'conversion'" :class="$style.content">
      <div class="thead" :class="$style.thead">
        <table>
          <thead>
            <tr>
              <th class="num" style="width: 5%;">#</th>
              <th class="nobreak">{{ $t('music_name') }}</th>
              <th class="nobreak" style="width: 20%;">{{ $t('download__progress') }}</th>
              <th class="nobreak" style="width: 22%;">{{ $t('download__status') }}</th>
              <th class="nobreak" style="width: 10%;">{{ $t('download__quality') }}</th>
              <th class="nobreak" style="width: 13%;">{{ $t('action') }}</th>
            </tr>
          </thead>
        </table>
      </div>
      <div v-if="list.length" ref="dom_listContent" :class="$style.content">
        <base-virtualized-list
          ref="listRef" v-slot="{ item, index }" :list="list" key-name="id" :item-height="listItemHeight"
          container-class="scroll" content-class="list"
        >
          <div
            class="list-item"
            :class="[{[$style.active]: playTaskId == item.id }, { selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }]"
            @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
          >
            <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 5%;">
              <transition name="play-active">
                <div v-if="playTaskId == item.id" :class="$style.playIcon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 512 512" space="preserve">
                    <use xlink:href="#icon-play-outline" />
                  </svg>
                </div>
                <div v-else class="num">{{ index + 1 }}</div>
              </transition>
            </div>
            <div class="list-item-cell auto name">
              <span class="select name" :aria-label="getName(item)">{{ getName(item) }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 20%;">{{ item.progress }}%<span v-if="item.status == downloadStatus.RUN && item.speed"> - {{ item.speed }}/s</span></div>
            <div class="list-item-cell" style="flex: 0 0 22%;" :aria-label="item.statusText">{{ item.statusText }}</div>
            <div class="list-item-cell" style="flex: 0 0 10%;">{{ getTypeName(item.metadata.quality) }}</div>
            <div class="list-item-cell" style="flex: 0 0 13%; padding-left: 0; padding-right: 0;">
              <material-list-buttons
                :index="index" :download-btn="false" :file-btn="item.status != downloadStatus.ERROR" remove-btn="remove-btn"
                :start-btn="!item.isComplate && item.status != downloadStatus.WAITING && (item.status != downloadStatus.RUN)"
                :pause-btn="!item.isComplate && (item.status == downloadStatus.RUN || item.status == downloadStatus.WAITING)"
                :list-add-btn="false" :play-btn="item.status == downloadStatus.COMPLETED"
                :search-btn="item.status == downloadStatus.ERROR" @btn-click="handleListBtnClick"
              />
            </div>
          </div>
        </base-virtualized-list>
      </div>
      <div v-else :class="$style.noItem">
        <p v-text="$t('no_item')" />
      </div>
      <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
      <!-- <base-menu :menus="listItemMenu" :location="listMenu.menuLocation" item-name="name" :is-show="listMenu.isShowItemMenu" @menu-click="handleListItemMenuClick" /> -->
    </div>
    <div v-else :class="$style.content">
      <div :class="['thead', $style.thead]">
        <table><thead><tr>
          <th class="nobreak">{{ $t('music_name') }}</th><th class="nobreak" style="width: 16%;">{{ $t('conversion__format') }}</th>
          <th class="nobreak" style="width: 18%;">{{ $t('download__progress') }}</th><th class="nobreak" style="width: 24%;">{{ $t('download__status') }}</th><th class="nobreak" style="width: 18%;">{{ $t('action') }}</th>
        </tr></thead></table>
      </div>
      <div v-if="conversionTasks.length" :class="$style.content">
        <base-virtualized-list v-slot="{ item }" :list="conversionTasks" key-name="id" :item-height="listItemHeight" container-class="scroll" content-class="list">
          <div class="list-item" :class="$style.convertRow">
            <div class="list-item-cell auto name"><span class="auto-hidden" :aria-label="item.inputPath">{{ getConversionName(item) }}</span></div>
            <div class="list-item-cell" style="flex: 0 0 16%;">{{ getConversionFormatName(item.format) }}</div>
            <div class="list-item-cell" style="flex: 0 0 18%;">{{ item.progress }}%</div>
            <div class="list-item-cell" style="flex: 0 0 24%;" :aria-label="item.error">{{ getConversionStatus(item) }}</div>
            <div class="list-item-cell" style="flex: 0 0 18%; gap: 6px;">
              <base-btn v-if="item.status == 'waiting' || item.status == 'running'" min @click="handleCancelConversion(item.id)">{{ $t('conversion__cancel') }}</base-btn>
              <base-btn v-else-if="item.status == 'error' || item.status == 'canceled'" min @click="handleRetryConversion(item.id)">{{ $t('conversion__retry') }}</base-btn>
              <base-btn v-if="item.status == 'completed'" min @click="handleOpenConversion(item.outputPath)">{{ $t('list__file') }}</base-btn>
              <base-btn v-if="item.status != 'running'" min @click="handleRemoveConversion(item.id)">{{ $t('list__remove') }}</base-btn>
            </div>
          </div>
        </base-virtualized-list>
      </div>
      <div v-else :class="$style.noItem"><p v-text="$t('no_item')" /></div>
    </div>
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedList" teleport="#view" @confirm="removeAllSelect" />
  </div>
</template>

<script>
// import { checkPath, openDirInExplorer, openUrl } from '@common/utils/electron'

import { computed, ref, onBeforeUnmount } from '@common/utils/vueTools'
import useListInfo from './useListInfo'
import useList from './useList'
import useTab from './useTab'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useTaskActions from './useTaskActions'
import useMusicAdd from './useMusicAdd'
import { downloadStatus } from '@renderer/store/download/state'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { formatMusicName } from '@renderer/utils'
import { addAudioConversionTasks, cancelAudioConversionTasks, getAudioConversionTasks, openDirInExplorer, removeAudioConversionTasks, retryAudioConversionTasks, showSelectDialog } from '@renderer/utils/ipc'

export default {
  name: 'Download',
  setup() {
    const listRef = ref()
    const { tabs, activeTab } = useTab()
    const convertFormat = computed({
      get: () => appSetting['download.convertFormat'],
      set: value => { updateSetting({ 'download.convertFormat': value }) },
    })
    const deleteConvertSource = computed({
      get: () => appSetting['download.deleteSourceAfterConvert'],
      set: value => { updateSetting({ 'download.deleteSourceAfterConvert': value }) },
    })
    const conversionTasks = ref([])
    const convertFormats = [
      { id: 'flac', name: 'FLAC' }, { id: 'alac', name: 'ALAC / M4A' }, { id: 'wav', name: 'WAV' },
      { id: 'wavpack', name: 'WavPack' }, { id: 'mp3', name: 'MP3（320 kbps）' }, { id: 'aac', name: 'AAC / M4A（320 kbps）' },
    ]
    const refreshConversionTasks = async() => {
      conversionTasks.value = await getAudioConversionTasks()
    }
    void refreshConversionTasks()
    const conversionTimer = window.setInterval(() => { void refreshConversionTasks() }, 1000)
    onBeforeUnmount(() => { window.clearInterval(conversionTimer) })
    const handleAddConversionFiles = async() => {
      const files = await showSelectDialog({ title: window.i18n.t('conversion__select_files'), properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['ape', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wv'] }] })
      if (files.canceled || !files.filePaths.length) return
      const output = await showSelectDialog({ title: window.i18n.t('conversion__select_output'), properties: ['openDirectory'] })
      if (output.canceled || !output.filePaths.length) return
      await addAudioConversionTasks({ filePaths: files.filePaths, outputDir: output.filePaths[0], format: convertFormat.value, deleteSource: deleteConvertSource.value })
      await refreshConversionTasks()
    }
    const handleCancelConversion = async(id) => { await cancelAudioConversionTasks([id]); await refreshConversionTasks() }
    const handleRetryConversion = async(id) => { await retryAudioConversionTasks([id]); await refreshConversionTasks() }
    const handleRemoveConversion = async(id) => { await removeAudioConversionTasks([id]); await refreshConversionTasks() }
    const handleOpenConversion = async(path) => { await openDirInExplorer(path) }
    const getConversionFormatName = format => convertFormats.find(item => item.id === format)?.name ?? format
    const getConversionName = task => task.inputPath.replace(/^.*[\\/]/, '')
    const getConversionStatus = task => task.error || ({ waiting: window.i18n.t('download___status_waiting'), running: window.i18n.t('conversion__running'), completed: window.i18n.t('download___status_completed'), canceled: window.i18n.t('conversion__canceled') })[task.status]

    const {
      rightClickSelectedIndex,
      dom_listContent,
      listAll,
      list,
      playTaskId,
    } = useListInfo(activeTab)

    const {
      selectedList,
      listItemHeight,
      removeAllSelect,
      handleSelectData,
    } = useList({ listRef, list, listAll })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
    } = usePlay({ selectedList, list, listAll, removeAllSelect })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleStartTask,
      handlePauseTask,
      handleRemoveTask,
      handleOpenFile,
    } = useTaskActions({ list, removeAllSelect, selectedList })

    const {
      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
    } = useMusicAdd({ selectedList, list })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      handleStartTask,
      handlePauseTask,
      handleRemoveTask,
      handleOpenFile,
      handlePlayMusic,
      handlePlayMusicLater,
      handleShowMusicAddModal,
      handleSearch,
      handleOpenMusicDetail,
    })

    let clickTime = 0
    let clickIndex = -1
    const doubleClickPlay = index => {
      if (
        window.performance.now() - clickTime > 400 ||
      clickIndex !== index
      ) {
        clickTime = window.performance.now()
        clickIndex = index
        return
      }
      const task = list.value[index]
      if (task.isComplate) {
        handlePlayMusic(list.value.indexOf(task), true)
      } else if (task.status === downloadStatus.RUN || task.status === downloadStatus.WAITING) {
        void handlePauseTask(index, true)
      } else {
        void handleStartTask(index, true)
      }
      clickTime = 0
      clickIndex = -1
    }

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, list.value[index], index)
    }
    const handleMenuClick = (action) => {
      let index = rightClickSelectedIndex.value
      rightClickSelectedIndex.value = -1
      menuClick(action, index)
    }

    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'play':
          handlePlayMusic(index, true)
          break
        case 'start':
          void handleStartTask(index, true)
          break
        case 'pause':
          void handlePauseTask(index, true)
          break
        case 'remove':
          void handleRemoveTask(index, true)
          break
        case 'file':
          void handleOpenFile(index)
          break
        case 'search':
          handleSearch(index)
          break
      }
    }

    const getName = (downloadInfo) => {
      return formatMusicName(appSetting['download.fileName'], downloadInfo.metadata.musicInfo.name, downloadInfo.metadata.musicInfo.singer)
    }
    const getTypeName = (quality) => {
      return quality == 'flac24bit' ? 'FLAC Hires' : quality?.toUpperCase()
    }
    return {
      listRef,
      list,
      downloadStatus,
      rightClickSelectedIndex,
      dom_listContent,
      tabs,
      activeTab,
      convertFormat,
      deleteConvertSource,
      convertFormats,
      conversionTasks,
      selectedList,
      listItemHeight,
      playTaskId,

      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,

      removeAllSelect,

      menus,
      menuLocation,
      isShowItemMenu,

      handleListItemClick,
      handleListItemRightClick,
      handleMenuClick,
      handleListBtnClick,
      handleAddConversionFiles,
      handleCancelConversion,
      handleRetryConversion,
      handleRemoveConversion,
      handleOpenConversion,
      getConversionFormatName,
      getConversionName,
      getConversionStatus,

      getName,
      getTypeName,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.download {
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;

  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
}
.header { display: flex; align-items: center; gap: 8px; }
.convertTools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.convertRow { display: flex; align-items: center; }
.num {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.playIcon {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-button-font);
  opacity: .7;
}

.content {
  min-height: 0;
  font-size: 14px;
  display: flex;
  flex-flow: column nowrap;
  flex: auto;
}

.noItem {
  position: relative;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

</style>
