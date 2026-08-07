export const SEARCH_HISTORY_LIMIT = {
  default: 15,
  min: 1,
  max: 1000,
} as const

export const normalizeSearchHistoryLimit = (value: unknown) => {
  if (value === '' || value === null || value === undefined) return SEARCH_HISTORY_LIMIT.default
  const limit = Number(value)
  if (!Number.isFinite(limit)) return SEARCH_HISTORY_LIMIT.default
  return Math.min(
    SEARCH_HISTORY_LIMIT.max,
    Math.max(SEARCH_HISTORY_LIMIT.min, Math.trunc(limit)),
  )
}

export const trimSearchHistoryList = <T>(list: T[], value: unknown) => {
  const limit = normalizeSearchHistoryLimit(value)
  if (list.length <= limit) return false
  list.splice(limit)
  return true
}
