// 桌面歌词界面（工具栏、解锁按钮）的大小跟着歌词字号走：以 28px 字号为 1 倍，限制在 0.7 ~ 1.4 倍之间，
// 歌词大的时候按钮也大、歌词小的时候按钮也小，不会出现“歌词很小、工具栏很大”或相反的情况
export const BASE_FONT_SIZE = 28

export const lyricUiScale = fontSize => {
  const size = Number(fontSize) || BASE_FONT_SIZE
  return Math.min(1.4, Math.max(0.7, size / BASE_FONT_SIZE))
}
