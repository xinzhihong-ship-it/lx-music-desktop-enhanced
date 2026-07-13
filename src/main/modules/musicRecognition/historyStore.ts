import { STORE_NAMES } from '@common/constants'
import getStore from '@main/utils/store'

const HISTORY_KEY = 'history'
const MAX_HISTORY = 50
let historyStore: ReturnType<typeof getStore> | null = null

const getHistoryStore = () => {
  historyStore ??= getStore(STORE_NAMES.MUSIC_RECOGNITION)
  return historyStore
}

export const getHistory = (): LX.MusicRecognition.Result[] => {
  return getHistoryStore().get<LX.MusicRecognition.Result[]>(HISTORY_KEY) ?? []
}

export const addHistory = (result: LX.MusicRecognition.Result): LX.MusicRecognition.Result[] => {
  const history = getHistory().filter(item => item.providerTrackId !== result.providerTrackId)
  history.unshift(result)
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
  getHistoryStore().set(HISTORY_KEY, history)
  return history
}

export const removeHistory = (id: string): LX.MusicRecognition.Result[] => {
  const history = getHistory().filter(item => item.id !== id)
  getHistoryStore().set(HISTORY_KEY, history)
  return history
}

export const clearHistory = () => {
  getHistoryStore().set(HISTORY_KEY, [])
}
