const fs = require('fs').promises
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

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
