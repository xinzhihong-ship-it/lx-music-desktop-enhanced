exports.formatInfo = {
  flac: { ext: 'flac', args: ['-c:a', 'flac'] },
  alac: { ext: 'm4a', args: ['-c:a', 'alac'] },
  wav: { ext: 'wav', args: ['-c:a', 'pcm_s24le'] },
  wavpack: { ext: 'wv', args: ['-c:a', 'wavpack'] },
  mp3: { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  aac: { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '320k'] },
}

exports.normalizeFormat = format => exports.formatInfo[format] ? format : 'flac'

exports.parseFfmpegTime = value => {
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(value)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

exports.shouldDeleteSource = (deleteSource, useCurrentDownloadDeleteSetting, currentDeleteSetting) => {
  return deleteSource && (!useCurrentDownloadDeleteSetting || currentDeleteSetting)
}
