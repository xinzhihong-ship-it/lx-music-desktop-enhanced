import type { PlayErrorAction } from './playErrorStrategy'

export interface RecoveryCombination<Music> {
  apiId: string
  musicInfo: Music
  quality: LX.Quality
}

const qualityLevels: readonly LX.Quality[] = ['master', 'atmos_plus', 'atmos', 'hires', 'flac', '320k', '192k', '128k']

export const getRecoveryQualityLevels = (preferred: LX.Quality): LX.Quality[] => {
  const canonical = preferred == 'flac24bit' ? 'hires' : preferred
  const index = qualityLevels.indexOf(canonical)
  return index < 0 ? [preferred] : qualityLevels.slice(index)
}

export const getRecoveryApiIds = (currentId: string, sourceIds: readonly string[], additionalCount: number): string[] => {
  const ids = [...new Set(sourceIds)]
  const index = ids.indexOf(currentId)
  const others = index < 0 ? ids : [...ids.slice(index + 1), ...ids.slice(0, index)]
  return [currentId, ...others.filter(id => id != currentId).slice(0, additionalCount)]
}

/**
 * The first configured action varies fastest. Later actions only vary after
 * every earlier combination is exhausted. Disabled dimensions stay fixed.
 * Platform lookup is lazy: source-first recovery must try the original
 * platform's sources before searching for other platforms.
 */
export async function * createPlaybackRecoveryPlan<Music>({ actions, apiIds, quality, original, getPlatforms }: {
  actions: readonly PlayErrorAction[]
  apiIds: readonly string[]
  quality: LX.Quality
  original: Music
  getPlatforms: () => Promise<Music[]>
}): AsyncGenerator<RecoveryCombination<Music>> {
  const dimensions = ['platform', 'apiSource', 'quality'] as const
  type Dimension = typeof dimensions[number]
  const enabled = [...new Set(actions)].filter((action): action is Dimension => action != 'next')
  const order = [...enabled, ...dimensions.filter(dimension => !enabled.includes(dimension))]
  let platformsPromise: Promise<Music[]> | null = null
  async function * values(dimension: Dimension): AsyncGenerator<Music | string> {
    switch (dimension) {
      case 'platform':
        yield original
        if (enabled.includes('platform')) {
          platformsPromise ??= getPlatforms()
          for (const music of await platformsPromise) yield music
        }
        break
      case 'apiSource':
        for (const id of enabled.includes('apiSource') ? apiIds : apiIds.slice(0, 1)) yield id
        break
      case 'quality':
        for (const level of enabled.includes('quality') ? getRecoveryQualityLevels(quality) : [quality]) yield level
        break
    }
  }
  async function * visit(depth: number, combination: RecoveryCombination<Music>): AsyncGenerator<RecoveryCombination<Music>> {
    if (depth < 0) {
      yield combination
      return
    }
    const dimension = order[depth]
    for await (const value of values(dimension)) {
      const next = { ...combination }
      if (dimension == 'platform') next.musicInfo = value as Music
      else if (dimension == 'apiSource') next.apiId = value as string
      else next.quality = value as LX.Quality
      yield * visit(depth - 1, next)
    }
  }
  yield * visit(order.length - 1, { apiId: apiIds[0], musicInfo: original, quality })
}
