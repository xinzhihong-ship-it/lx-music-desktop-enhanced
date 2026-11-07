// 歌词用的播放时间（单独成模块：歌词引擎 engine.ts 与行跟踪 core/lyric.ts 都要用，避免二者循环引用）
import { getCurrentTime as getPlayerCurrentTime } from '@renderer/plugins/player'
import { vst3Runtime } from '@renderer/plugins/player/vst3'
import { appSetting } from '@renderer/store/setting'
import { isBiliVideoActive } from '@renderer/store/player/biliVideo'

/** 播放器当前时间（毫秒，已扣除 VST3 处理延迟） */
export const getCurrentTime = () => {
  const delay = vst3Runtime.active && appSetting['player.playEngine'] === 'electron' && !isBiliVideoActive()
    ? (vst3Runtime.latencyMs + vst3Runtime.bridgeMs) * appSetting['player.playbackRate'] : 0
  return Math.max(0, getPlayerCurrentTime() * 1000 - delay)
}
