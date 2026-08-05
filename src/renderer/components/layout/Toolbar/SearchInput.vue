<template>
  <material-search-input v-model="searchText" :list="tipList" :visible-list="visibleList" @event="handleEvent" />
</template>

<script>
import music from '@renderer/utils/musicSdk'
import { debounce } from '@common/utils'
import {
  markRaw,
  ref,
  watch,
  nextTick,
} from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { appSetting } from '@renderer/store/setting'
import { searchText as _searchText } from '@renderer/store/search/state'
import { setSearchText } from '@renderer/store/search/action'
import { getSearchSetting } from '@renderer/utils/data'
import { parseBiliVideoUrl } from '@renderer/utils/musicSdk/bili/url'
import { toNewMusicInfo } from '@renderer/utils'
import { addTempPlayList, setAllStatus } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playNext } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'

export default {
  setup() {
    const searchText = ref('')
    const visibleList = ref(false)
    const tipList = ref([])
    let isFocused = false
    let prevTempSearchSource = ''

    const route = useRoute()
    const router = useRouter()

    watch(() => route.name, (newValue, oldValue) => {
      if (oldValue == 'Search' && newValue != 'SongListDetail') {
        setTimeout(() => {
          if (appSetting['odc.isAutoClearSearchInput'] && searchText.value) searchText.value = ''
          if (appSetting['odc.isAutoClearSearchList']) setSearchText('')
        })
      }
    })

    watch(_searchText, (newValue, oldValue) => {
      searchText.value = newValue
      if (newValue !== searchText.value) searchText.value = newValue
    })
    watch(searchText, () => {
      handleTipSearch()
    })


    const tipSearch = debounce(async() => {
      if (searchText.value === '' && prevTempSearchSource) {
        tipList.value = []
        music[prevTempSearchSource].tipSearch.cancelTipSearch()
        return
      }
      if (parseBiliVideoUrl(searchText.value)) {
        tipList.value = []
        return
      }
      const { temp_source } = await getSearchSetting()
      prevTempSearchSource ||= temp_source
      music[prevTempSearchSource].tipSearch.search(searchText.value).then(list => {
        tipList.value = list
      }).catch(() => {})
    }, 50)

    const handleTipSearch = () => {
      if (!visibleList.value && isFocused) visibleList.value = true
      tipSearch()
    }

    const handleSearch = async() => {
      visibleList.value &&= false
      if (!searchText.value && route.path != '/search') {
        setSearchText('')
        return
      }
      const biliUrl = parseBiliVideoUrl(searchText.value)
      if (biliUrl) {
        setAllStatus('正在读取哔哩哔哩地址…')
        try {
          const rawMusicInfo = await music.bili.getMusicInfoByUrl(searchText.value)
          if (!rawMusicInfo) throw new Error('地址格式不正确')
          const musicInfo = markRaw(toNewMusicInfo(rawMusicInfo))
          const isPlaying = !!playMusicInfo.musicInfo
          addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo, isTop: true }])
          if (isPlaying) void playNext()
        } catch (err) {
          setAllStatus(`哔哩哔哩地址播放失败：${err?.message || '无法获取视频'}`)
        }
        return
      }
      setTimeout(() => {
        router.push({
          path: '/search',
          query: {
            text: searchText.value,
          },
        }).catch(_ => _)
      }, searchText.value ? 200 : 0)
    }

    const handleEvent = ({ action, data }) => {
      switch (action) {
        case 'focus':
          isFocused = true
          visibleList.value ||= true
          if (searchText.value) handleTipSearch()
          break
        case 'blur':
          isFocused = false
          setTimeout(() => {
            visibleList.value &&= false
          }, 50)
          break
        case 'submit':
          void handleSearch()
          break
        case 'listClick':
          searchText.value = tipList.value[data]
          void nextTick(() => { void handleSearch() })
      }
    }

    return {
      searchText,
      visibleList,
      tipList,
      handleEvent,
    }
  },
}

</script>
