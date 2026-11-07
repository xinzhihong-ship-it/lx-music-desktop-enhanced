const fs = require('node:fs/promises')
const path = require('node:path')

// Disk-image copying filters AppleDouble sidecars. Remove them before signing
// so CodeResources never seals files that will disappear from the mounted app.
const removeAppleDoubleFiles = async(directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  let removed = 0
  for (const entry of entries) {
    const filename = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.startsWith('._')) {
      await fs.unlink(filename)
      removed++
    } else if (entry.isDirectory()) removed += await removeAppleDoubleFiles(filename)
  }
  return removed
}

// 随包的 mpv.app 默认是普通应用：每次启动 / 切换文件时 macOS 都可能把它当作前台应用处理，程序坞会闪一下。
// 在它的 Info.plist 里加 LSUIElement（后台辅助程序，不进程序坞），改动 Info.plist 后要重新签名这个 .app，
// 外层 app 的签名随后再封装一次。exec 可注入，便于测试。
const markAgentApp = async(appBundle, exec) => {
  const plist = path.join(appBundle, 'Contents', 'Info.plist')
  await fs.access(plist)
  await exec('plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist])
  await exec('codesign', ['--force', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', appBundle])
}

module.exports = { removeAppleDoubleFiles, markAgentApp }
