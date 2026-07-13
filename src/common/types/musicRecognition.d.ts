declare namespace LX {
  namespace MusicRecognition {
    type Source = 'system' | 'mic'
    type Status = 'idle' | 'requestingPermission' | 'capturing' | 'recognizing' | 'matched' | 'notMatched' | 'permissionDenied' | 'noAudio' | 'networkError' | 'error' | 'unsupported'

    interface Result {
      id: string
      title: string
      artist: string
      album?: string
      coverUrl?: string
      shazamUrl?: string
      provider: 'shazam' | 'acrcloud'
      providerTrackId: string
      recognizedAt: number
    }

    interface AcrcloudConfig {
      enabled: boolean
      host: string
      accessKey: string
      accessSecret: string
    }

    interface Snapshot {
      status: Status
      history: Result[]
      result?: Result
      alternatives?: Result[]
      error?: string
      captureProgress?: number
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
