import { useRouter } from '@common/utils/vueRouter'
import musicSdk from '@renderer/utils/musicSdk'
import { openUrl } from '@common/utils/electron'
import { toOldMusicInfo } from '@renderer/utils'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'


export default ({ props }) => {
  const router = useRouter()
  const t = useI18n()

  const handleSearch = index => {
    const info = props.list[index]
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  const handleSimilarSongs = index => {
    const info = props.list[index]
    const isPlatformSource = ['wy', 'tx', 'kg'].includes(info.source)
    router.push({
      path: '/similar',
      query: {
        source: info.source,
        ...(isPlatformSource ? { songId: String(info.source === 'tx' ? (info.meta.id ?? info.meta.songId) : info.meta.songId) } : {}),
        platformId: info.source === 'tx' ? String(info.meta.id ?? '') : '',
        hash: info.source === 'kg' ? String(info.meta.hash ?? '') : '',
        name: info.name,
        singer: info.singer,
        interval: info.interval || '',
        albumName: info.meta.albumName || '',
      },
    })
  }

  const handleOpenMusicDetail = index => {
    const minfo = props.list[index]
    const url = musicSdk[minfo.source]?.getMusicDetailPageUrl?.(toOldMusicInfo(minfo))
    if (!url) return
    openUrl(url)
  }

  const handleDislikeMusic = async(index) => {
    const minfo = props.list[index]
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
    if (hasDislike(playMusicInfo.musicInfo)) {
      playNext(true)
    }
  }


  return {
    handleSearch,
    handleSimilarSongs,
    handleOpenMusicDetail,
    handleDislikeMusic,
  }
}
