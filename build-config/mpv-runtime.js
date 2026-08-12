const fs = require('fs')
const path = require('path')

const getRequiredMacMpvPaths = arch => [
  path.join('mpv.app', 'Contents', 'MacOS', 'mpv'),
  ...(arch === 'arm64'
    ? [path.join('mpv-macos26.app', 'Contents', 'MacOS', 'mpv')]
    : []),
]

const validateMacMpvRuntimes = (rootDir, arch) => {
  const missing = getRequiredMacMpvPaths(arch)
    .filter(relativePath => !fs.existsSync(path.join(rootDir, relativePath)))
  if (missing.length) {
    throw new Error(`Missing bundled MPV runtime for macOS ${arch}: ${missing.join(', ')}`)
  }
}

module.exports = { getRequiredMacMpvPaths, validateMacMpvRuntimes }
