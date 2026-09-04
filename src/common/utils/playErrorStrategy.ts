export const PLAY_ERROR_ACTIONS = ['apiSource', 'platform', 'quality', 'next'] as const
export type PlayErrorAction = typeof PLAY_ERROR_ACTIONS[number]

export const PLAY_ERROR_RETRY_COUNT = { default: 1, min: 0, max: 5 } as const
export const PLAY_ERROR_API_SOURCE_COUNT = { default: 2, min: 1, max: 10 } as const

const actionSet = new Set<string>(PLAY_ERROR_ACTIONS)

export const normalizePlayErrorStrategyOrder = (value: unknown): PlayErrorAction[] => {
  const order = Array.isArray(value)
    ? value.filter((action): action is PlayErrorAction => typeof action == 'string' && actionSet.has(action))
    : []
  const uniqueOrder = [...new Set(order)].filter(action => action != 'next')
  return [...uniqueOrder, ...PLAY_ERROR_ACTIONS.filter(action => action != 'next' && !uniqueOrder.includes(action)), 'next']
}

const normalizeCount = (value: unknown, range: { default: number, min: number, max: number }) => {
  if (value === '' || value === null || value === undefined) return range.default
  const count = Number(value)
  if (!Number.isFinite(count)) return range.default
  return Math.min(range.max, Math.max(range.min, Math.trunc(count)))
}

export const normalizePlayErrorRetryCount = (value: unknown) => normalizeCount(value, PLAY_ERROR_RETRY_COUNT)
export const normalizePlayErrorApiSourceCount = (value: unknown) => normalizeCount(value, PLAY_ERROR_API_SOURCE_COUNT)

export const getPlayErrorActions = (
  strategy: 'auto' | 'source' | 'quality' | 'next',
  order: unknown,
): PlayErrorAction[] => {
  switch (strategy) {
    case 'source': return ['platform']
    case 'quality': return ['quality']
    case 'next': return ['next']
    default: return normalizePlayErrorStrategyOrder(order)
  }
}

export const movePlayErrorAction = (value: unknown, oldIndex: number, newIndex: number) => {
  const order = normalizePlayErrorStrategyOrder(value)
  if (oldIndex == newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= order.length || newIndex >= order.length) return order
  if (order[oldIndex] == 'next' || newIndex == order.length - 1) return order
  const [action] = order.splice(oldIndex, 1)
  order.splice(newIndex, 0, action)
  return order
}

export const getNextApiSourceId = (currentId: string, triedIds: ReadonlySet<string>, sourceIds: string[]) => {
  const currentIndex = sourceIds.indexOf(currentId)
  const orderedIds = currentIndex < 0
    ? sourceIds
    : [...sourceIds.slice(currentIndex + 1), ...sourceIds.slice(0, currentIndex)]
  return orderedIds.find(id => id != currentId && !triedIds.has(id)) ?? null
}
