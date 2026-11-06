// 歌词时钟漂移防护。
//
// 歌词播放器按自己的时钟走，只在播放 / 暂停 / 跳转时与播放器对齐。播放器卡住却不发暂停事件时
// （MPV 网络缓存耗尽、macOS 输出设备掉线或切换等，MPV 不会上报 waiting），声音停了歌词还在走，
// 恢复出声后歌词就比声音超前。这里定时比较播放器真实时间与歌词时钟：
//   - 真实时间长时间不动 → 'stall'：暂停歌词
//   - 卡住后真实时间重新前进 → 'resume'：从真实时间继续
//   - 两者相差超过容差 → 'resync'：按真实时间重新对齐
// 纯逻辑，不依赖播放器，便于测试。时间单位均为毫秒。

export type LyricDriftAction = 'none' | 'stall' | 'resume' | 'resync'

export interface LyricDriftGuardOptions {
  /** 歌词时钟与真实时间允许的最大偏差 */
  tolerance?: number
  /** 真实时间多久不前进视为卡住（需大于播放器时间上报的最大间隔） */
  stallAfter?: number
}

interface DriftState {
  anchorTime: number
  anchorAt: number
  rate: number
  lastTime: number
  lastChangeAt: number
  stalled: boolean
}

export const DEFAULT_LYRIC_DRIFT_TOLERANCE = 350
export const DEFAULT_LYRIC_STALL_AFTER = 1500

export const createLyricDriftGuard = ({
  tolerance = DEFAULT_LYRIC_DRIFT_TOLERANCE,
  stallAfter = DEFAULT_LYRIC_STALL_AFTER,
}: LyricDriftGuardOptions = {}) => {
  let state: DriftState | null = null

  return {
    /** 歌词从 time 开始播放（每次调用 lrc.play 时同步调用） */
    start(time: number, now: number, rate = 1) {
      state = { anchorTime: time, anchorAt: now, rate: rate > 0 ? rate : 1, lastTime: time, lastChangeAt: now, stalled: false }
    },
    /** 歌词已暂停或停止 */
    stop() {
      state = null
    },
    get active() {
      return state != null
    },
    /** 用播放器当前真实时间检查一次；返回需要执行的动作（resume / resync 时内部已按 actual 重新锚定） */
    check(actual: number, now: number): LyricDriftAction {
      if (!state) return 'none'
      if (Math.abs(actual - state.lastTime) > 1) {
        state.lastTime = actual
        state.lastChangeAt = now
        if (state.stalled) {
          state.stalled = false
          state.anchorTime = actual
          state.anchorAt = now
          return 'resume'
        }
      } else if (!state.stalled) {
        if (now - state.lastChangeAt >= stallAfter) {
          state.stalled = true
          return 'stall'
        }
        // 尚未判定为卡住：真实时间短暂不动属正常（上报有间隔），不据此重新对齐
        return 'none'
      }
      if (state.stalled) return 'none'
      const expected = state.anchorTime + (now - state.anchorAt) * state.rate
      if (Math.abs(expected - actual) > tolerance) {
        state.anchorTime = actual
        state.anchorAt = now
        return 'resync'
      }
      return 'none'
    },
  }
}

export type LyricDriftGuard = ReturnType<typeof createLyricDriftGuard>
