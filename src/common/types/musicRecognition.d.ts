declare namespace LX {
  namespace MusicRecognition {
    type Source = 'system' | 'mic'
    type Status = 'idle' | 'requestingPermission' | 'capturing' | 'recognizing' | 'matched' | 'notMatched' | 'permissionDenied' | 'noAudio' | 'networkError' | 'error' | 'unsupported'
    type Engine = 'kg' | 'wy' | 'shazam' | 'acrcloud'
    type EngineStatus = 'matched' | 'notMatched' | 'error'

    interface Result {
      id: string
      title: string
      artist: string
      album?: string
      coverUrl?: string
      shazamUrl?: string
      provider: 'shazam' | 'acrcloud' | 'wy' | 'tx' | 'kg'
      providerTrackId: string
      recognizedAt: number
    }

    interface RecognitionHint {
      title: string
      artist: string
      album?: string
      coverUrl?: string
      provider?: 'wy' | 'tx' | 'kg'
      providerTrackId?: string
    }

    interface RecognizePcmRequest {
      pcm: Uint8Array
      hint?: RecognitionHint
    }

    interface AcrcloudConfig {
      enabled: boolean
      host: string
      accessKey: string
      accessSecret: string
    }

    interface EngineReport {
      engine: Engine
      status: EngineStatus
      error?: string
    }

    interface Snapshot {
      status: Status
      history: Result[]
      result?: Result
      alternatives?: Result[]
      error?: string
      captureProgress?: number
      engineReports?: EngineReport[]
    }
  }
}

declare module 'st-shazam/src/algorithm' {
  interface ShazamSignature {
    sampleRateHz: number
    numberSamples: number
    encodeToUri: () => string
  }

  export class SignatureGenerator {
    getSignature: (samples: Int16Array) => ShazamSignature
  }
}
