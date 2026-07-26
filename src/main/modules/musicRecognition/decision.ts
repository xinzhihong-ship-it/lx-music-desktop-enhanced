export const selectConsensusKey = (keys: string[]): string | null => {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const count = (counts.get(key) ?? 0) + 1
    if (count >= 2) return key
    counts.set(key, count)
  }
  return null
}

export const isAmbiguousRecognition = (
  matchedEngines: LX.MusicRecognition.Engine[],
  hintSupportsMatch: boolean,
): boolean => {
  if (hintSupportsMatch) return false
  return !matchedEngines.some(engine => engine === 'shazam' || engine === 'acrcloud')
}

export const promoteRecognitionCandidate = (
  current: LX.MusicRecognition.Result,
  candidate: LX.MusicRecognition.Result,
): LX.MusicRecognition.Result => ({
  ...candidate,
  id: current.id,
  recognizedAt: current.recognizedAt,
  confidence: 'confirmed',
})

export const selectAlternativeCandidates = <T>(
  match: T,
  candidates: T[],
  getKey: (candidate: T) => string,
  getPriority: (match: T, candidate: T) => number,
  limit: number,
): T[] => {
  const seen = new Set([getKey(match)])
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => getPriority(match, a.candidate) - getPriority(match, b.candidate) || a.index - b.index)
    .flatMap(({ candidate }) => {
      const key = getKey(candidate)
      if (seen.has(key)) return []
      seen.add(key)
      return [candidate]
    })
    .slice(0, limit)
}
