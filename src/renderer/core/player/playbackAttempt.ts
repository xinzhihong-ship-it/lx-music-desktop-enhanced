export interface PlaybackAttempt {
  ownerId: string
  requestId?: number
  apiId: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
}

let currentAttempt: PlaybackAttempt | null = null

// Keep recovery state separate from playlist entries. A temporary playback
// platform must not rewrite the user's song or its server-side playlist.
export const setCurrentPlaybackAttempt = (attempt: PlaybackAttempt) => { currentAttempt = attempt }
export const getCurrentPlaybackAttempt = () => currentAttempt

export const playbackAttemptKey = (attempt: PlaybackAttempt) => JSON.stringify([
  attempt.apiId,
  attempt.musicInfo.source,
  attempt.musicInfo.id,
  attempt.quality == 'flac24bit' ? 'hires' : attempt.quality,
])
