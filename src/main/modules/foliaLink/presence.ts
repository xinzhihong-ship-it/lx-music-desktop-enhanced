// Folia 有没有经「Folia 对接」连着：连着时 Folia 自己跟随落雪播放，舞台推送（foliaStage）就不再推，
// 免得 Folia 的舞台把它自己的播放挤掉。
type Listener = (active: boolean) => void

let active = false
const listeners = new Set<Listener>()

export const isFoliaLinkClientActive = () => active

export const setFoliaLinkClientActive = (value: boolean) => {
  if (active === value) return
  active = value
  for (const listener of listeners) listener(value)
}

export const onFoliaLinkClientActiveChange = (listener: Listener) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
