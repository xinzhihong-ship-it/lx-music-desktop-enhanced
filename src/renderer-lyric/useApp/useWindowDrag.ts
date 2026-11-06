// 在歌词区域按下拖动即可移动桌面歌词窗口（原先在歌词视图里实现，单独抽出）
import { onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'
import { setWindowBounds, setWindowResizeable } from '@lyric/utils/ipc'
import { isWin } from '@common/utils'

export default () => {
  const isDragging = ref(false)
  const state = { downX: 0, downY: 0, width: 0, height: 0 }

  const start = (x: number, y: number) => {
    isDragging.value = true
    state.downX = x
    state.downY = y
    state.width = window.innerWidth
    state.height = window.innerHeight
    // https://github.com/lyswhut/lx-music-desktop/issues/2244
    if (isWin) setWindowResizeable(false)
  }
  const move = (x: number, y: number) => {
    if (!isDragging.value) return
    setWindowBounds({
      x: x - state.downX,
      y: y - state.downY,
      w: isWin ? state.width : window.innerWidth,
      h: isWin ? state.height : window.innerHeight,
    })
  }
  const end = () => {
    if (!isDragging.value) return
    isDragging.value = false
    if (isWin) setWindowResizeable(true)
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button != 0) return
    start(event.clientX, event.clientY)
  }
  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.changedTouches[0]
    if (touch) start(touch.clientX, touch.clientY)
  }
  const handleMouseMove = (event: MouseEvent) => { move(event.clientX, event.clientY) }
  const handleTouchMove = (event: TouchEvent) => {
    const touch = event.changedTouches[0]
    if (touch) move(touch.clientX, touch.clientY)
  }

  onMounted(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', end)
    document.addEventListener('touchmove', handleTouchMove)
    document.addEventListener('touchend', end)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', end)
    document.removeEventListener('touchmove', handleTouchMove)
    document.removeEventListener('touchend', end)
  })

  return { isDragging, handleMouseDown, handleTouchStart }
}
