
import { throttle } from '@common/utils/common'
import { normalizeSearchHistoryLimit, trimSearchHistoryList } from '@common/utils/searchHistory'
import { toRaw } from '@common/utils/vueTools'
import {
  getSearchHistoryList,
  saveSearchHistoryList,
} from '@renderer/utils/ipc'
import { appSetting, updateSetting } from '../setting'
import { searchText, historyList } from './state'


export const setSearchText = (text: string) => {
  searchText.value = text
}

let isInitedSearchHistory = false
const saveSearchHistoryListThrottle = throttle((list: LX.List.SearchHistoryList) => {
  saveSearchHistoryList(list)
}, 500)


export const getHistoryList = async() => {
  if (isInitedSearchHistory || historyList.length) return
  historyList.push(...(await getSearchHistoryList() ?? []))
  isInitedSearchHistory ||= true
}
export const addHistoryWord = async(word: string) => {
  if (!appSetting['search.isShowHistorySearch']) return
  if (!isInitedSearchHistory) await getHistoryList()
  let index = historyList.indexOf(word)
  if (index === 0) return
  if (index > -1) historyList.splice(index, 1)
  historyList.unshift(word)
  trimSearchHistoryList(historyList, appSetting['search.historyLimit'])
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const setHistoryLimit = async(value: unknown) => {
  const limit = normalizeSearchHistoryLimit(value)
  updateSetting({ 'search.historyLimit': limit })
  if (!isInitedSearchHistory) await getHistoryList()
  if (!trimSearchHistoryList(historyList, limit)) return
  saveSearchHistoryList(toRaw(historyList))
}
export const removeHistoryWord = (index: number) => {
  historyList.splice(index, 1)
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const clearHistoryList = () => {
  historyList.splice(0, historyList.length)
  saveSearchHistoryList([])
}
