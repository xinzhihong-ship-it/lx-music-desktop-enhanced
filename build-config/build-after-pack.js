const fs = require('fs').promises
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { Arch } = require('electron-builder')
const { validateMacMpvRuntimes } = require('./mpv-runtime')
const { getVst3HostPlan, validateVst3HostBinary } = require('./build-vst3-host')

const execFileAsync = promisify(execFile)

const findFiles = async(dir, extension) => {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await findFiles(entryPath, extension))
    else if (entry.name.endsWith(extension)) files.push(entryPath)
  }
  return files
}

const signMpvNativeFiles = async(appPath) => {
  const nativeDir = path.join(appPath, 'Contents/Resources/app.asar.unpacked/build/Release')
  const candidateFiles = [
    path.join(nativeDir, 'lx_mpv_video.node'),
    ...await findFiles(path.join(nativeDir, 'mpv-libs'), '.dylib'),
  ]
  for (const filePath of candidateFiles) {
    await fs.access(filePath)
    await execFileAsync('codesign', [
      '--force',
      '--sign', '-',
      '--options', 'runtime',
      filePath,
    ])
  }
}

const signMacAppForLocalUse = async(appPath, vst3HostPath = null) => {
  const entitlements = path.resolve(__dirname, '../resources/entitlements.mac.plist')
  const audioTeePath = path.join(appPath, 'Contents/Resources/bin/music-recognition/audiotee')
  const signBinary = async(filePath) => {
    await execFileAsync('codesign', [
      '--force',
      '--sign', '-',
      '--options', 'runtime',
      '--entitlements', entitlements,
      filePath,
    ])
  }
  await signBinary(audioTeePath)
  if (vst3HostPath) await signBinary(vst3HostPath)
  await signMpvNativeFiles(appPath)
  await execFileAsync('codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', entitlements,
    appPath,
  ])
  if (vst3HostPath) {
    await execFileAsync('codesign', ['--verify', '--strict', vst3HostPath])
  }
}

// https://github.com/electron-userland/electron-builder/issues/4630
// https://github.com/electron-userland/electron-builder/issues/4630#issuecomment-782020139

module.exports = async(context) => {
  const { electronPlatformName, appOutDir, arch } = context
  const { productFilename } = context.packager.appInfo
  const targetArch = arch === Arch.arm64 || arch === 'arm64'
    ? 'arm64'
    : arch === Arch.ia32 || arch === 'ia32' || arch === 'x86'
      ? 'ia32'
      : arch === Arch.armv7l || arch === 'armv7l'
        ? 'armv7l'
        : arch === 'x86_64'
          ? 'x64'
          : 'x64'
  const appPath = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${productFilename}.app`)
    : appOutDir
  const resPath = electronPlatformName === 'darwin'
    ? path.join(appPath, 'Contents/Resources')
    : path.join(appPath, 'resources')
  const vst3Plan = getVst3HostPlan(electronPlatformName, targetArch)
  const vst3HostPath = path.join(resPath, 'bin', vst3Plan.name)
  if (vst3Plan.supported) {
    const validation = validateVst3HostBinary(vst3HostPath, electronPlatformName, targetArch)
    console.log(`[vst3] verified packaged host ${vst3HostPath} (${validation.architectures.join(',')})`)
  } else {
    try {
      await fs.access(vst3HostPath)
      throw new Error(`Unsupported VST3 target ${electronPlatformName}-${targetArch} unexpectedly contains ${vst3HostPath}`)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    console.log(`[vst3] verified host omitted for ${electronPlatformName}-${targetArch}`)
  }
  if (electronPlatformName !== 'darwin') return

  const {
    info: {
      _metadata: { macLanguagesInfoPlistStrings },
    },
  } = context.packager.appInfo
  validateMacMpvRuntimes(path.join(resPath, 'bin'), targetArch)

  // 创建APP语言包文件
  await Promise.all(
    Object.entries(macLanguagesInfoPlistStrings).map(([lang, config]) => {
      let infos = Object.entries(config).map(([k, v]) => `"${k}" = "${v}";`).join('\n')
      return fs.writeFile(`${resPath}/${lang}.lproj/InfoPlist.strings`, infos)
    }),
  )

  // electron-builder leaves development packages with Electron's generic identity
  // when no Developer ID is installed, which prevents macOS from granting audio capture.
  await signMacAppForLocalUse(appPath, vst3Plan.supported ? vst3HostPath : null)
}
