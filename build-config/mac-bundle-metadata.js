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
module.exports = { removeAppleDoubleFiles }
