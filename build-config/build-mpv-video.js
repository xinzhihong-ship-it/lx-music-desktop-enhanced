const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const sourceDir = path.join(root, 'native/mpv-video')
const sourceFile = path.join(sourceDir, 'build/Release/lx_mpv_video.node')
const targetFile = path.join(root, 'build/Release/lx_mpv_video.node')
const runtimeDir = path.join(root, 'build/Release/mpv-libs')
const windowSourceDir = path.join(root, 'native/mpv-window')
const windowSourceFile = path.join(windowSourceDir, 'build/Release/lx_mpv_window.node')
const windowTargetFile = path.join(root, 'build/Release/lx_mpv_window.node')
const nodeGyp = path.join(root, 'node_modules/node-gyp/bin/node-gyp.js')

const getDylibDependencies = (filePath) => execFileSync('otool', ['-L', filePath], { encoding: 'utf8' })
  .split(/\r?\n/)
  .slice(1)
  .map(line => line.trim().split(' (compatibility')[0])
  .filter(Boolean)

const isHomebrewPath = filePath => filePath.startsWith('/opt/homebrew/') || filePath.startsWith('/usr/local/')

const bundleMpvRuntime = (mpvPrefix) => {
  const mpvLibrary = path.join(mpvPrefix, 'lib/libmpv.2.dylib')
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  fs.mkdirSync(runtimeDir, { recursive: true })

  const queue = [mpvLibrary]
  const dependencies = new Map()
  while (queue.length) {
    const sourcePath = queue.shift()
    const sourceRealPath = fs.realpathSync(sourcePath)
    const targetName = path.basename(sourcePath)
    if (dependencies.has(targetName)) {
      if (dependencies.get(targetName) !== sourceRealPath) throw new Error(`macOS MPV 依赖重名：${targetName}`)
      continue
    }
    fs.copyFileSync(sourceRealPath, path.join(runtimeDir, targetName))
    dependencies.set(targetName, sourceRealPath)
    for (const dependency of getDylibDependencies(sourceRealPath)) {
      if (isHomebrewPath(dependency)) queue.push(dependency)
    }
  }

  for (const [targetName, sourcePath] of dependencies) {
    const targetPath = path.join(runtimeDir, targetName)
    for (const dependency of getDylibDependencies(sourcePath)) {
      if (!isHomebrewPath(dependency)) continue
      execFileSync('install_name_tool', ['-change', dependency, `@rpath/${path.basename(dependency)}`, targetPath])
    }
    try {
      execFileSync('install_name_tool', ['-id', `@rpath/${targetName}`, targetPath])
    } catch {}
    try {
      execFileSync('install_name_tool', ['-add_rpath', '@loader_path', targetPath])
    } catch {}
  }

  execFileSync('install_name_tool', [
    '-change',
    mpvLibrary,
    `@loader_path/mpv-libs/${path.basename(mpvLibrary)}`,
    targetFile,
  ])
  console.log(`[mpv video] bundled ${dependencies.size} macOS MPV libraries`)
}

const buildMpvVideoNative = () => {
  if (process.platform !== 'darwin') return false
  const defaultPrefixes = process.arch === 'arm64'
    ? ['/opt/homebrew/opt/mpv', '/usr/local/opt/mpv']
    : ['/usr/local/opt/mpv', '/opt/homebrew/opt/mpv']
  const mpvPrefix = process.env.LX_MPV_PREFIX || defaultPrefixes.find(prefix => fs.existsSync(path.join(prefix, 'include/mpv/client.h')) && fs.existsSync(path.join(prefix, 'lib/libmpv.2.dylib'))) || defaultPrefixes[0]
  if (!fs.existsSync(path.join(mpvPrefix, 'include/mpv/client.h')) || !fs.existsSync(path.join(mpvPrefix, 'lib/libmpv.2.dylib'))) {
    console.warn(`[mpv video] native bridge skipped: libmpv not found at ${mpvPrefix}`)
    return false
  }
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--directory', sourceDir, '--', `-Dmpv_prefix=${mpvPrefix}`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MPV_PREFIX: mpvPrefix },
  })
  if (result.status !== 0 || !fs.existsSync(sourceFile)) throw new Error('mpv video native bridge build failed')
  fs.mkdirSync(path.dirname(targetFile), { recursive: true })
  fs.copyFileSync(sourceFile, targetFile)
  bundleMpvRuntime(mpvPrefix)
  console.log(`[mpv video] native bridge ready: ${targetFile}`)
  return true
}

const buildMpvWindowNative = arch => {
  if (process.platform !== 'win32') return false
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--directory', windowSourceDir, `--arch=${arch}`], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0 || !fs.existsSync(windowSourceFile)) throw new Error('Windows MPV video host build failed')
  fs.mkdirSync(path.dirname(windowTargetFile), { recursive: true })
  fs.copyFileSync(windowSourceFile, windowTargetFile)
  console.log(`[mpv video] Windows host ready: ${windowTargetFile}`)
  return true
}

if (require.main === module) {
  if (process.platform === 'win32') buildMpvWindowNative(process.arch)
  else buildMpvVideoNative()
}

module.exports = { buildMpvVideoNative, buildMpvWindowNative }
