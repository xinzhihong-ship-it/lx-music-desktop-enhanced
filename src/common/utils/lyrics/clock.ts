// 歌词显示用的媒体时钟。
// 播放器的时间是离散上报的（MPV 由 time-pos 事件和每秒轮询推送，Audirvana 轮询），
// 直接拿来逐帧显示会一跳一跳。这里在两次上报之间按播放速度外推，并保证：
//   - 播放中不回退（新上报略落后于外推值时保持外推，避免抖动）；明显的回跳（跳转）立即采用
//   - 外推最多 maxExtrapolate 毫秒：上报停了（卡住）就停在那里，不会一直往前跑
// 纯逻辑，时间单位毫秒。

export interface MediaClockOptions {
  /** 两次上报之间最多外推多久 */
  maxExtrapolate?: number
  /** 回退多少以内视为上报抖动而非跳转 */
  jitter?: number
}

export const createMediaClock = ({ maxExtrapolate = 1200, jitter = 250 }: MediaClockOptions = {}) => {
  let sampleTime = 0
  let sampleAt = 0
  let playing = false
  let rate = 1
  let last = 0

  const extrapolate = (now: number) => playing
    ? sampleTime + Math.min(Math.max(0, now - sampleAt), maxExtrapolate) * rate
    : sampleTime

  return {
    /** 记录一次播放器时间（每帧调用即可，值不变时不会刷新外推起点） */
    sample(time: number, now: number, isPlaying: boolean, playbackRate = 1) {
      const nextRate = playbackRate > 0 ? playbackRate : 1
      if (time !== sampleTime || isPlaying !== playing || nextRate !== rate) {
        sampleTime = time
        sampleAt = now
        playing = isPlaying
        rate = nextRate
      }
    },
    /** now 时刻用于显示的位置 */
    position(now: number) {
      const value = extrapolate(now)
      // 播放中小幅回退是上报间隔造成的，保持上一帧位置；大幅回退是跳转，直接采用
      if (playing && value < last && last - value <= jitter) return last
      last = value
      return value
    },
    /** 跳转 / 换歌时丢弃单调性记忆 */
    reset(time = 0, now = 0) {
      sampleTime = time
      sampleAt = now
      last = time
    },
  }
}

export type MediaClock = ReturnType<typeof createMediaClock>
