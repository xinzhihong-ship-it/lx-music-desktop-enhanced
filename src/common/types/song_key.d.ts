declare namespace LX {
  namespace SongKey {
    type Scale = 'major' | 'minor'
    type Source = 'user' | 'database' | 'analysis'

    interface KeyInfo {
      key: string
      scale: Scale
      label: string
      camelot: string
      source: Source
      confidence?: number
      custom?: boolean
      updatedAt?: number
      /**
       * 全曲调性时间轴。歌曲中途转调（主歌→副歌、升 key）时按播放位置切换。
       * 只有真实音频分析会产生；曲库/手动设定的结果是单值，没有这个字段。
       */
      timeline?: Segment[]
    }

    /** 时间轴上的一段：从 at 秒开始（到下一段的 at 结束）都是这个调 */
    interface Segment {
      at: number
      key: string
      scale: Scale
      label: string
      camelot: string
      confidence: number
    }

    /** 主进程按 Range 取回的一段音频字节，供渲染进程解码分析 */
    interface AudioChunk {
      bytes: Uint8Array
      totalBytes: number | null
      truncated: boolean
    }

    type UserSongKeys = Record<string, KeyInfo>
  }
}
