export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export type NoteName = typeof NOTE_NAMES[number]

export const NOTE_ALIASES: Record<string, NoteName> = {
  C: 'C',
  'B#': 'C',
  'C#': 'C#',
  Db: 'C#',
  D: 'D',
  'D#': 'D#',
  Eb: 'D#',
  E: 'E',
  Fb: 'E',
  F: 'F',
  'E#': 'F',
  'F#': 'F#',
  Gb: 'F#',
  G: 'G',
  'G#': 'G#',
  Ab: 'G#',
  A: 'A',
  'A#': 'A#',
  Bb: 'A#',
  B: 'B',
  Cb: 'B',
}

// Display-friendly flat note names for certain keys (e.g. F Major prefers Bb over A#)
export const DISPLAY_NOTE_NAMES: Record<NoteName, string> = {
  C: 'C',
  'C#': 'Db',
  D: 'D',
  'D#': 'Eb',
  E: 'E',
  F: 'F',
  'F#': 'F#',
  G: 'G',
  'G#': 'Ab',
  A: 'A',
  'A#': 'Bb',
  B: 'B',
}

// Camelot Wheel mapping
// Major: B=1B, F#=2B, Db=3B, Ab=4B, Eb=5B, Bb=6B, F=7B, C=8B, G=9B, D=10B, A=11B, E=12B
// Minor: G#m=1A, D#m=2A, Bbm=3A, Fm=4A, Cm=5A, Gm=6A, Dm=7A, Am=8A, Em=9A, Bm=10A, F#m=11A, C#m=12A
export const CAMELOT_MAP: Record<string, string> = {
  'B major': '1B',
  'F# major': '2B',
  'C# major': '3B',
  'G# major': '4B',
  'D# major': '5B',
  'A# major': '6B',
  'F major': '7B',
  'C major': '8B',
  'G major': '9B',
  'D major': '10B',
  'A major': '11B',
  'E major': '12B',
  'G# minor': '1A',
  'D# minor': '2A',
  'A# minor': '3A',
  'F minor': '4A',
  'C minor': '5A',
  'G minor': '6A',
  'D minor': '7A',
  'A minor': '8A',
  'E minor': '9A',
  'B minor': '10A',
  'F# minor': '11A',
  'C# minor': '12A',
}

// Krumhansl-Kessler Key Profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export const normalizeNote = (input: string): NoteName => {
  const trimmed = input.trim().toUpperCase()
  const formatted = trimmed.length > 1
    ? trimmed[0] + (trimmed[1] === '#' ? '#' : trimmed[1].toLowerCase())
    : trimmed
  return NOTE_ALIASES[formatted] ?? 'C'
}

export const formatKeyLabel = (key: NoteName, scale: LX.SongKey.Scale): string => {
  const displayNote = (['C#', 'D#', 'G#', 'A#'].includes(key)) ? DISPLAY_NOTE_NAMES[key] : key
  if (scale === 'minor') {
    return `${displayNote}m 小调`
  }
  return `1=${displayNote} 大调`
}

export const getCamelotCode = (key: NoteName, scale: LX.SongKey.Scale): string => {
  return CAMELOT_MAP[`${key} ${scale}`] ?? ''
}

export const getSemitonesFromPlaybackRate = (playbackRate: number): number => {
  if (!playbackRate || playbackRate <= 0) return 0
  return Math.round(12 * Math.log2(playbackRate))
}

export const transposeKey = (
  root: NoteName,
  scale: LX.SongKey.Scale,
  semitones: number,
): { key: NoteName, scale: LX.SongKey.Scale, label: string, camelot: string } => {
  const rootIndex = NOTE_NAMES.indexOf(root)
  const newIndex = ((rootIndex + semitones) % 12 + 12) % 12
  const newKey = NOTE_NAMES[newIndex]
  return {
    key: newKey,
    scale,
    label: formatKeyLabel(newKey, scale),
    camelot: getCamelotCode(newKey, scale),
  }
}

const pearsonCorrelation = (x: Float32Array, y: Float32Array): number => {
  let meanX = 0
  let meanY = 0
  for (let i = 0; i < 12; i++) {
    meanX += x[i]
    meanY += y[i]
  }
  meanX /= 12
  meanY /= 12

  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < 12; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  return denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0
}

const MIDI_START = 36
const MIDI_COUNT = 48
const MIDI_FREQS = new Float64Array(MIDI_COUNT)
for (let i = 0; i < MIDI_COUNT; i++) {
  MIDI_FREQS[i] = 440 * Math.pow(2, (i + MIDI_START - 69) / 12)
}

const COEFF_CACHE = new Map<number, Float64Array>()
const getCoeffs = (sampleRate: number): Float64Array => {
  let coeffs = COEFF_CACHE.get(sampleRate)
  if (!coeffs) {
    coeffs = new Float64Array(MIDI_COUNT)
    for (let i = 0; i < MIDI_COUNT; i++) {
      coeffs[i] = 2 * Math.cos(2 * Math.PI * MIDI_FREQS[i] / sampleRate)
    }
    COEFF_CACHE.set(sampleRate, coeffs)
  }
  return coeffs
}

/**
 * Extract 12-semitone chroma energy profile and run K-S key correlation
 */
export const analyzeAudioKey = (
  samples: Float32Array,
  sampleRate: number,
): { key: NoteName, scale: LX.SongKey.Scale, label: string, camelot: string, confidence: number } => {
  const chroma = new Float32Array(12)
  const numSamples = samples.length
  if (numSamples < 1024 || sampleRate <= 0) {
    return { key: 'C', scale: 'major', label: '1=C 大调', camelot: '8B', confidence: 0 }
  }

  const coeffs = getCoeffs(sampleRate)

  // Sample piano frequencies C2 (65.4 Hz) to B5 (987.7 Hz)
  for (let idx = 0; idx < MIDI_COUNT; idx++) {
    const coeff = coeffs[idx]
    const pc = (idx + MIDI_START) % 12
    let sPrev = 0
    let sPrev2 = 0
    for (let i = 0; i < numSamples; i++) {
      const s = samples[i] + coeff * sPrev - sPrev2
      sPrev2 = sPrev
      sPrev = s
    }
    const power = sPrev * sPrev + sPrev2 * sPrev2 - coeff * sPrev * sPrev2
    chroma[pc] += Math.sqrt(Math.max(0, power))
  }

  // Normalize chroma
  let sum = 0
  for (let i = 0; i < 12; i++) sum += chroma[i]
  if (sum > 0) {
    for (let i = 0; i < 12; i++) chroma[i] /= sum
  }

  let bestKey: NoteName = 'C'
  let bestScale: LX.SongKey.Scale = 'major'
  let bestScore = -1

  for (let root = 0; root < 12; root++) {
    const rotMajor = new Float32Array(12)
    const rotMinor = new Float32Array(12)
    for (let i = 0; i < 12; i++) {
      rotMajor[(root + i) % 12] = MAJOR_PROFILE[i]
      rotMinor[(root + i) % 12] = MINOR_PROFILE[i]
    }
    const scoreMaj = pearsonCorrelation(chroma, rotMajor)
    const scoreMin = pearsonCorrelation(chroma, rotMinor)
    if (scoreMaj > bestScore) {
      bestScore = scoreMaj
      bestKey = NOTE_NAMES[root]
      bestScale = 'major'
    }
    if (scoreMin > bestScore) {
      bestScore = scoreMin
      bestKey = NOTE_NAMES[root]
      bestScale = 'minor'
    }
  }

  const confidence = Math.max(0, Math.min(1, Math.round(bestScore * 100) / 100))
  return {
    key: bestKey,
    scale: bestScale,
    label: formatKeyLabel(bestKey, bestScale),
    camelot: getCamelotCode(bestKey, bestScale),
    confidence,
  }
}
