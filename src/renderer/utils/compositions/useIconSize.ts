import { type Ref, onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'

const onDomSizeChanged = (dom: HTMLElement, onChanged: (width: number, height: number) => void) => {
  let frameId: number | null = null
  let lastWidth = -1
  const notify = (width: number, height: number) => {
    const nextWidth = Math.trunc(width)
    if (nextWidth === lastWidth) return
    lastWidth = nextWidth
    if (frameId != null) window.cancelAnimationFrame(frameId)
    frameId = window.requestAnimationFrame(() => {
      frameId = null
      onChanged(nextWidth, Math.trunc(height))
    })
  }

  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const { width, height } = entry.contentRect
      notify(width, height)
    }
  })

  resizeObserver.observe(dom)
  notify(dom.clientWidth, dom.clientHeight)

  return () => {
    if (frameId != null) window.cancelAnimationFrame(frameId)
    resizeObserver.disconnect()
  }
}

export const useIconSize = (parentDom: Ref<HTMLElement | undefined>, size: number) => {
  const iconSize = ref('32px')
  let unsub: (() => void) | null = null

  onMounted(() => {
    if (!parentDom.value) return
    unsub = onDomSizeChanged(parentDom.value, (width, height) => {
      iconSize.value = Math.trunc(width * size) + 'px'
    })
  })
  onBeforeUnmount(() => {
    unsub?.()
  })

  return iconSize
}
