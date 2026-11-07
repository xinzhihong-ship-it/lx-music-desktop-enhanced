// 歌词滚动的临界阻尼弹簧：滚到新行时从当前显示位置（连同当前速度）平滑地追到目标，
// 不过冲。x(t) = target + (a + b·t)·e^(−ωt)，ω 越大越快（10 时一两行的距离约 800ms 收敛到 0.5px）。

export const GLIDE_OMEGA = 10

export const createGlide = (omega = GLIDE_OMEGA) => {
  let target = 0
  let a = 0 // 起始偏差（显示位置 - 目标）
  let b = 0
  let start = 0
  let active = false

  const offsetAt = (now: number) => {
    if (!active) return { lag: 0, velocity: 0 }
    const t = Math.max(0, now - start) / 1000
    const e = Math.exp(-omega * t)
    return { lag: (a + b * t) * e, velocity: (b - omega * (a + b * t)) * e }
  }

  return {
    /** 当前显示位置 */
    value(now: number) {
      return target + offsetAt(now).lag
    },
    get target() {
      return target
    },
    /** 是否还在运动（偏差和速度都足够小时视为停止） */
    isMoving(now: number) {
      if (!active) return false
      const { lag, velocity } = offsetAt(now)
      if (Math.abs(lag) < 0.5 && Math.abs(velocity) < 20) {
        active = false
        return false
      }
      return true
    },
    /** 从当前显示位置出发滑向 next；instant 时直接到位（减少动画 / 首次定位） */
    to(next: number, now: number, instant = false) {
      const { lag, velocity } = offsetAt(now)
      const shown = target + lag
      target = next
      if (instant) {
        active = false
        a = 0
        b = 0
        return
      }
      a = shown - next
      // 速度单位：像素 / 秒，与 t 的单位一致
      b = velocity + omega * a
      start = now
      active = Math.abs(a) >= 0.5 || Math.abs(velocity) >= 20
    },
  }
}

export type Glide = ReturnType<typeof createGlide>
