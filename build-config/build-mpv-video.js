const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const sourceDir = path.join(root, 'native/mpv-video')
const sourceFile = path.join(sourceDir, 'build/Release/lx_mpv_video.node')
const targetFile = path.join(root, 'build/Release/lx_mpv_video.node')

const buildMpvVideoNative = () => {
  if (process.platform !== 'darwin') return false
  const mpvPrefix = process.env.LX_MPV_PREFIX || '/opt/homebrew/opt/mpv'
  if (!fs.existsSync(path.join(mpvPrefix, 'include/mpv/client.h')) || !fs.existsSync(path.join(mpvPrefix, 'lib/libmpv.2.dylib'))) {
    console.warn(`[mpv video] native bridge skipped: libmpv not found at ${mpvPrefix}`)
    return false
  }
  const nodeGyp = path.join(root, 'node_modules/node-gyp/bin/node-gyp.js')
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--directory', sourceDir], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MPV_PREFIX: mpvPrefix },
  })
  if (result.status !== 0 || !fs.existsSync(sourceFile)) throw new Error('mpv video native bridge build failed')
  fs.mkdirSync(path.dirname(targetFile), { recursive: true })
  fs.copyFileSync(sourceFile, targetFile)
  console.log(`[mpv video] native bridge ready: ${targetFile}`)
  return true
}

if (require.main === module) buildMpvVideoNative()

module.exports = { buildMpvVideoNative }
