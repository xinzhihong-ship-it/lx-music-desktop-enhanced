/**
 * 自动下载并集成 mpv 二进制到 resources/mpv/<平台>-<架构>/。
 *
 * 说明：
 * - 运行前请确认你遵守 mpv / FFmpeg 相关的 GPL/LGPL 许可证义务。
 * - 本脚本不会把二进制提交到 git（resources/mpv/.gitignore 已忽略）。
 * - 下载的二进制仅在打包时通过 extraResources 复制到安装包内，终端用户无需自己安装 mpv。
 *
 * 用法：
 *   node build-config/download-mpv.js --platform=darwin --arch=arm64
 *   node build-config/download-mpv.js --platform=win32 --arch=x64
 *   node build-config/download-mpv.js --platform=linux --arch=x64
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const needle = require('needle')
const tar = require('tar')

const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'mpv')
const TEMP_DIR = path.join(__dirname, '..', 'build', 'mpv-downloads')

// 可配置的下载源。版本号更新时在这里改即可。
const SOURCES = {
  darwin: {
    // stolendata 的 macOS 构建通常是通用二进制（x64 + arm64），放在同一个 mpv.app 里。
    url: 'https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-0.39.0.tar.gz',
    archiveType: 'tar.gz',
  },
  win32: {
    // 使用 GitHub latest release API 动态获取 shinchiro 构建的下载地址。
    repo: 'shinchiro/mpv-winbuild-cmake',
    assetNamePattern: (arch) => {
      if (arch === 'x64') return /^mpv-x86_64-.*\.7z$/
      if (arch === 'arm64') return /^mpv-aarch64-.*\.7z$/
      throw new Error(`[win32-${arch}] Unsupported architecture for auto-download. Supported: x64, arm64.`)
    },
    archiveType: '7z',
  },
  linux: {
    // Linux 可移植静态构建没有官方稳定源，默认不自动下载。
    // 如果你有自己的静态构建 URL，可以填在这里，例如：
    // url: 'https://your-mirror.example.com/mpv-linux-x64',
    // archiveType: 'none', // 或 'tar.gz' / 'zip'
  },
}

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const download = async (url, dest) => {
  console.log(`Downloading: ${url}`)
  const resp = await needle('get', url, { follow_max: 5, decode_response: false })
  if (resp.statusCode !== 200) {
    throw new Error(`Download failed: ${url} (status ${resp.statusCode})`)
  }
  fs.writeFileSync(dest, resp.body)
  console.log(`Saved: ${dest} (${fs.statSync(dest).size} bytes)`)
}

const getGitHubLatestAssetUrl = async (repo, pattern) => {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`
  console.log(`Fetching latest release: ${apiUrl}`)
  const resp = await needle('get', apiUrl, {
    follow_max: 5,
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (resp.statusCode !== 200) {
    throw new Error(`GitHub API failed: ${apiUrl} (status ${resp.statusCode})`)
  }
  const release = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
  const asset = release.assets?.find(a => pattern.test(a.name))
  if (!asset) {
    throw new Error(`No matching asset found in ${repo} release. Assets: ${release.assets?.map(a => a.name).join(', ')}`)
  }
  return asset.browser_download_url
}

const extractTarGz = async (archivePath, outDir) => {
  ensureDir(outDir)
  await tar.x({ file: archivePath, C: outDir })
}

const extract7z = async (archivePath, outDir) => {
  ensureDir(outDir)
  const sevenZip = await find7z()
  execFileSync(sevenZip, ['x', archivePath, `-o${outDir}`, '-y'], { stdio: 'inherit' })
}

const find7z = async () => {
  // 先尝试系统 PATH 里的 7z
  try {
    execFileSync(process.platform === 'win32' ? '7z.exe' : '7z', ['--help'], { stdio: 'ignore' })
    return process.platform === 'win32' ? '7z.exe' : '7z'
  } catch {}

  // Windows 常见安装路径
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
  }

  // 都没找到就下载一个最小版 7zr 到临时目录
  const sevenZrPath = path.join(TEMP_DIR, '7zr.exe')
  if (!fs.existsSync(sevenZrPath)) {
    console.log('7z not found, downloading minimal 7zr.exe...')
    // 7zr 只能解压 7z，足够本项目使用
    const resp = await needle('get', 'https://www.7-zip.org/a/7zr.exe', { follow_max: 5, decode_response: false })
    if (resp.statusCode !== 200) {
      throw new Error(`7zr download failed: ${resp.statusCode}`)
    }
    fs.writeFileSync(sevenZrPath, resp.body)
    console.log(`Saved 7zr: ${sevenZrPath}`)
  }
  return sevenZrPath
}

const findBinary = (dir, name) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, name)
      if (found) return found
    } else if (entry.name === name) {
      return fullPath
    }
  }
  return null
}

const findDir = (dir, name) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.name === name) return fullPath
    const found = findDir(fullPath, name)
    if (found) return found
  }
  return null
}

const downloadDarwin = async (arch) => {
  const source = SOURCES.darwin
  const targetDir = path.join(RESOURCES_DIR, `darwin-${arch}`)
  const binaryPath = path.join(targetDir, 'mpv.app', 'Contents', 'MacOS', 'mpv')
  if (fs.existsSync(binaryPath)) {
    console.log(`[darwin-${arch}] mpv already exists, skipping.`)
    return
  }

  ensureDir(TEMP_DIR)
  const archivePath = path.join(TEMP_DIR, `mpv-darwin-${arch}.tar.gz`)
  await download(source.url, archivePath)

  const extractDir = path.join(TEMP_DIR, `extract-darwin-${arch}`)
  await extractTarGz(archivePath, extractDir)

  const appBundleDir = findDir(extractDir, 'mpv.app')
  if (!appBundleDir) {
    throw new Error(`[darwin-${arch}] mpv.app not found in extracted archive.`)
  }

  ensureDir(targetDir)
  fs.rmSync(path.join(targetDir, 'mpv.app'), { recursive: true, force: true })
  fs.renameSync(appBundleDir, path.join(targetDir, 'mpv.app'))
  console.log(`[darwin-${arch}] Installed mpv to ${path.join(targetDir, 'mpv.app')}`)
}

const downloadWin32 = async (arch) => {
  const source = SOURCES.win32
  const targetDir = path.join(RESOURCES_DIR, `win32-${arch}`)
  const binaryPath = path.join(targetDir, 'mpv.exe')
  if (fs.existsSync(binaryPath)) {
    console.log(`[win32-${arch}] mpv.exe already exists, skipping.`)
    return
  }

  const assetUrl = await getGitHubLatestAssetUrl(source.repo, source.assetNamePattern(arch))
  ensureDir(TEMP_DIR)
  const archivePath = path.join(TEMP_DIR, `mpv-win32-${arch}.7z`)
  await download(assetUrl, archivePath)

  const extractDir = path.join(TEMP_DIR, `extract-win32-${arch}`)
  await extract7z(archivePath, extractDir)

  // shinchiro 的 7z 包中 mpv.exe 与所需 DLL 通常位于同一目录，整体复制才能运行
  const exePath = findBinary(extractDir, 'mpv.exe')
  if (!exePath) {
    throw new Error(`[win32-${arch}] mpv.exe not found in extracted archive.`)
  }
  const sourceDir = path.dirname(exePath)

  ensureDir(targetDir)
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.cpSync(sourceDir, targetDir, { recursive: true, dereference: true })
  console.log(`[win32-${arch}] Installed mpv (exe + deps) to ${targetDir}`)
}

const downloadLinux = async (arch) => {
  const source = SOURCES.linux
  if (!source.url) {
    console.warn(`[linux-${arch}] No configured static mpv source. Skipping. Linux users will need to install mpv via their package manager, or you can set SOURCES.linux.url manually.`)
    return
  }
  const targetDir = path.join(RESOURCES_DIR, `linux-${arch}`)
  const binaryPath = path.join(targetDir, 'mpv')
  if (fs.existsSync(binaryPath)) {
    console.log(`[linux-${arch}] mpv already exists, skipping.`)
    return
  }

  ensureDir(TEMP_DIR)
  const fileName = path.basename(new URL(source.url).pathname) || `mpv-linux-${arch}`
  const archivePath = path.join(TEMP_DIR, fileName)
  await download(source.url, archivePath)

  ensureDir(targetDir)
  if (source.archiveType === 'none') {
    fs.copyFileSync(archivePath, binaryPath)
    fs.chmodSync(binaryPath, 0o755)
  } else if (source.archiveType === 'tar.gz') {
    const extractDir = path.join(TEMP_DIR, `extract-linux-${arch}`)
    await extractTarGz(archivePath, extractDir)
    const found = findBinary(extractDir, 'mpv')
    if (!found) throw new Error(`[linux-${arch}] mpv not found in extracted archive.`)
    const sourceDir = path.dirname(found)
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.cpSync(sourceDir, targetDir, { recursive: true, dereference: true })
    fs.chmodSync(binaryPath, 0o755)
  } else {
    throw new Error(`[linux-${arch}] Unsupported archiveType: ${source.archiveType}`)
  }
  console.log(`[linux-${arch}] Installed mpv to ${binaryPath}`)
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const result = {}
  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, '').split('=')
    result[key] = value
  }
  return result
}

const downloadMpv = async (platform, arch) => {
  ensureDir(RESOURCES_DIR)

  switch (platform) {
    case 'darwin':
      await downloadDarwin(arch)
      break
    case 'win32':
      await downloadWin32(arch)
      break
    case 'linux':
      await downloadLinux(arch)
      break
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

const main = async () => {
  const { platform, arch } = parseArgs()
  if (!platform || !arch) {
    console.error('Usage: node build-config/download-mpv.js --platform=<win32|darwin|linux> --arch=<x64|arm64|armv7l|x86>')
    process.exit(1)
  }

  await downloadMpv(platform, arch)
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { downloadMpv }
