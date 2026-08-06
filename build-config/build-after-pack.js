const fs = require('fs').promises
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

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

const signMacAppForLocalUse = async(appPath) => {
  const entitlements = path.resolve(__dirname, '../resources/entitlements.mac.plist')
  const audioTeePath = path.join(appPath, 'Contents/Resources/bin/music-recognition/audiotee')
  await execFileAsync('codesign', [
    '--force',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', entitlements,
    audioTeePath,
  ])
  await signMpvNativeFiles(appPath)
  await execFileAsync('codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', entitlements,
    appPath,
  ])
}

// https://github.com/electron-userland/electron-builder/issues/4630
// https://github.com/electron-userland/electron-builder/issues/4630#issuecomment-782020139

module.exports = async(context) => {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return
  const {
    productFilename,
    info: {
      _metadata: { macLanguagesInfoPlistStrings },
    },
  } = context.packager.appInfo

  const resPath = `${appOutDir}/${productFilename}.app/Contents/Resources`

  // 创建APP语言包文件
  await Promise.all(
    Object.entries(macLanguagesInfoPlistStrings).map(([lang, config]) => {
      let infos = Object.entries(config).map(([k, v]) => `"${k}" = "${v}";`).join('\n')
      return fs.writeFile(`${resPath}/${lang}.lproj/InfoPlist.strings`, infos)
    }),
  )

  // electron-builder leaves development packages with Electron's generic identity
  // when no Developer ID is installed, which prevents macOS from granting audio capture.
  await signMacAppForLocalUse(`${appOutDir}/${productFilename}.app`)
}
