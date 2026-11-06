import { computed, ref, shallowReactive, reactive, nextTick } from '@common/utils/vueTools'
import musicSdk from '@renderer/utils/musicSdk'
import { useI18n } from '@renderer/plugins/i18n'
import { DOWNLOAD_STATUS } from '@common/constants'

export default ({
  handleStartTask,
  handlePauseTask,
  handleRemoveTask,
  handleOpenFile,
  handlePlayMusic,
  handlePlayMusicLater,
  handleShowMusicAddModal,
  handleSearch,
  handleOpenMusicDetail,
}) => {
  const itemMenuControl = reactive({
    play: true,
    start: true,
    reconvert: false,
    pause: true,
    playLater: true,
    file: true,
    sourceDetail: true,
    search: true,
    remove: true,
    addTo: true,
  })
  const t = useI18n()
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowItemMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('list__play'),
        action: 'play',
        hide: !itemMenuControl.play,
      },
      {
        name: t('list__start'),
        action: 'start',
        hide: !itemMenuControl.start,
      },
      {
        name: t('download__reconvert'),
        action: 'reconvert',
        hide: !itemMenuControl.reconvert,
      },
      {
        name: t('list__pause'),
        action: 'pause',
        hide: !itemMenuControl.pause,
      },
      {
        name: t('list__play_later'),
        action: 'playLater',
        hide: !itemMenuControl.playLater,
      },
      {
        name: t('list__file'),
        action: 'file',
        hide: !itemMenuControl.file,
      },
      {
        name: t('list__add_to'),
        action: 'addTo',
        disabled: !itemMenuControl.addTo,
      },
      {
        name: t('list__source_detail'),
        action: 'sourceDetail',
        disabled: !itemMenuControl.sourceDetail,
      },
      {
        name: t('list__search'),
        action: 'search',
        hide: !itemMenuControl.search,
      },
      {
        name: t('list__remove'),
        action: 'remove',
        hide: !itemMenuControl.remove,
      },
    ]
  })

  const showMenu = (event, taskInfo) => {
    itemMenuControl.sourceDetail = !!musicSdk[taskInfo.metadata.musicInfo.source]?.getMusicDetailPageUrl

    // 下载已完成但转换失败（ERROR + isComplate）：可播放 / 打开源文件，并提供「仅重新转换」
    itemMenuControl.reconvert = taskInfo.isComplate && taskInfo.status === DOWNLOAD_STATUS.ERROR
    if (taskInfo.isComplate) {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.file = true
      itemMenuControl.start =
        itemMenuControl.pause = false
    } else if (taskInfo.status === DOWNLOAD_STATUS.ERROR || taskInfo.status === DOWNLOAD_STATUS.PAUSE) {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.pause =
        itemMenuControl.file = false
      itemMenuControl.start = true
    } else {
      itemMenuControl.play =
        itemMenuControl.playLater =
        itemMenuControl.start =
        itemMenuControl.file = false
      itemMenuControl.pause = true
    }

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowItemMenu.value) return

    nextTick(() => {
      isShowItemMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowItemMenu.value = false
  }

  const menuClick = (action, index) => {
    // console.log(action)
    hideMenu()
    if (!action) return
    switch (action.action) {
      case 'start':
      case 'reconvert':
        // 转换失败的任务由 store 的 startTask 自动走「仅重新转换」
        handleStartTask(index)
        break
      case 'pause':
        handlePauseTask(index)
        break
      case 'file':
        handleOpenFile(index)
        break
      case 'play':
        handlePlayMusic(index)
        break
      case 'playLater':
        handlePlayMusicLater(index)
        break
      case 'addTo':
        handleShowMusicAddModal(index)
        break
      case 'search':
        handleSearch(index)
        break
      case 'remove':
        handleRemoveTask(index)
        break
      case 'sourceDetail':
        handleOpenMusicDetail(index)
    }
  }

  return {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  }
}
