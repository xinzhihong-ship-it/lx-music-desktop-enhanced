// 封面取色与播放详情页背景配色（纯函数）。
// 主色：封面缩成小图后按色相分 18 桶，以 饱和度²×明度 加权，取权重最大的桶的加权平均色；
// 几乎没有鲜艳像素（灰度封面）时取平均色。背景用主色的色相，固定在较深的明度，保证白字可读。

export interface Rgb { r: number, g: number, b: number }

export const rgbToHsv = ({ r, g, b }: Rgb) => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max == rn) h = ((gn - bn) / d) % 6
    else if (max == gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max == 0 ? 0 : d / max, v: max }
}

export const hsvToRgb = (h: number, s: number, v: number): Rgb => {
  const c = v * s
  const hh = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
}

const BUCKETS = 18

/** pixels 为 RGBA 字节数组（如 canvas getImageData().data），返回主色 */
export const dominantColor = (pixels: ArrayLike<number>): Rgb => {
  const weight = new Array<number>(BUCKETS).fill(0)
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0])
  const gray = [0, 0, 0]
  let count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue // 透明像素不计
    const color = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }
    gray[0] += color.r
    gray[1] += color.g
    gray[2] += color.b
    count++
    const { h, s, v } = rgbToHsv(color)
    if (s < 0.15 || v < 0.15) continue
    const w = s * s * v
    const k = Math.floor(h / 360 * BUCKETS) % BUCKETS
    weight[k] += w
    sums[k][0] += color.r * w
    sums[k][1] += color.g * w
    sums[k][2] += color.b * w
  }
  if (!count) return { r: 120, g: 120, b: 130 }
  let best = 0
  for (let k = 1; k < BUCKETS; k++) if (weight[k] > weight[best]) best = k
  // 鲜艳像素太少（灰度封面）：用平均色
  if (weight[best] < Math.max(2, count * 0.01)) {
    return { r: Math.round(gray[0] / count), g: Math.round(gray[1] / count), b: Math.round(gray[2] / count) }
  }
  const w = weight[best]
  return { r: Math.round(sums[best][0] / w), g: Math.round(sums[best][1] / w), b: Math.round(sums[best][2] / w) }
}

const toCss = ({ r, g, b }: Rgb, alpha = 1) => alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`

export interface BackdropPalette {
  top: string
  bottom: string
  /** 强调色（光晕、导引线、火花）：主色向白色混合 */
  accent: string
  accentRgb: Rgb
}

/** 由主色生成背景渐变（上浅下深）与强调色；灰色封面保持灰色 */
export const backdropPalette = (tint: Rgb): BackdropPalette => {
  const { h, s } = rgbToHsv(tint)
  const saturation = s > 0.12 ? Math.min(Math.max(s * 1.3, 0.45), 0.66) : s
  const top = hsvToRgb(h, saturation, 0.35)
  const bottom = hsvToRgb(h, Math.min(saturation * 1.05, 0.7), 0.24)
  const accentRgb = {
    r: Math.round(tint.r + (255 - tint.r) * 0.45),
    g: Math.round(tint.g + (255 - tint.g) * 0.45),
    b: Math.round(tint.b + (255 - tint.b) * 0.45),
  }
  return { top: toCss(top), bottom: toCss(bottom), accent: toCss(accentRgb), accentRgb }
}

export const rgbaCss = toCss
