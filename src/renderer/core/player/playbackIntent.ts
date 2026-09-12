// Engine pause/error events are also emitted during loading and recovery. Keep
// the user's intent separate so those internal events cannot cancel a retry.
let playing = false
let revision = 0
const listeners = new Set<(playing: boolean) => void>()

export const getPlaybackIntent = () => playing
export const getPlaybackIntentRevision = () => revision

export const setPlaybackIntent = (value: boolean) => {
  playing = value
  revision++
  for (const listener of listeners) listener(value)
}

export const onPlaybackIntentChange = (listener: (playing: boolean) => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
