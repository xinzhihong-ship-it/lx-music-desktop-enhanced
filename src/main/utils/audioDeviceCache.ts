// Share probes within a generation; a refresh or binary-path change prevents
// older results from populating the cache used by the next playback request.
export const createAudioDeviceCache = <T>(ttlMs = 15000) => {
  let key = ''
  let generation = 0
  let cached: { value: T[], at: number } | undefined
  let pending: { generation: number, promise: Promise<T[]> } | undefined
  return {
    get: async(nextKey: string, force: boolean, probe: () => Promise<T[]>, cacheable: (rows: T[]) => boolean): Promise<T[]> => {
      if (key !== nextKey || force) {
        key = nextKey
        generation++
        cached = undefined
        pending = undefined
      }
      if (pending?.generation === generation) return pending.promise
      if (cached && Date.now() - cached.at < ttlMs) return cached.value
      const current = generation
      const promise = probe().then(value => {
        if (generation === current && cacheable(value)) cached = { value, at: Date.now() }
        return value
      }).finally(() => {
        if (pending?.promise === promise) pending = undefined
      })
      pending = { generation: current, promise }
      return promise
    },
  }
}
