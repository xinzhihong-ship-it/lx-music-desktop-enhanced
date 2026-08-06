import { ref } from '@common/utils/vueTools'
import { playMusicInfo } from './state'

export const biliVideoQualityOptions = ['auto', '360p', '480p', '720p', '720p60', '1080p', '1080p+', '1080p60', '4K', '8K'] as const
export type BiliVideoQuality = (typeof biliVideoQualityOptions)[number]

export const biliPlaybackMode = ref<'audio' | 'video'>('audio')
export const biliVideoQuality = ref<BiliVideoQuality>('auto')

const getOnlineMusicInfo = (value: LX.Music.MusicInfo | LX.Download.ListItem | null) => {
  if (!value) return null
  return 'progress' in value ? value.metadata.musicInfo : value
}

export const isBiliMusic = (value: LX.Music.MusicInfo | LX.Download.ListItem | null) => getOnlineMusicInfo(value)?.source === 'bili'

export const isBiliVideoActive = () => biliPlaybackMode.value === 'video' && isBiliMusic(playMusicInfo.musicInfo)
