declare global {
  namespace LX {
    namespace AudioConversion {
      type Format = 'flac' | 'alac' | 'wav' | 'wavpack' | 'mp3' | 'aac'
      type Status = 'waiting' | 'running' | 'completed' | 'error' | 'canceled'

      interface Task {
        id: string
        inputPath: string
        outputPath: string
        outputDir: string
        format: Format
        deleteSource: boolean
        useCurrentDownloadDeleteSetting?: boolean
        status: Status
        progress: number
        error?: string
        createdAt: number
      }

      interface AddParams {
        filePaths: string[]
        outputDir: string
        format: Format
        deleteSource: boolean
        useCurrentDownloadDeleteSetting?: boolean
      }
    }
  }
}

export {}
