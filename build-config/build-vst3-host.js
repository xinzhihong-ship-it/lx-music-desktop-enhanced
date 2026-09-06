const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cwd = path.join(root, 'native/vst3-host')

const hostBinaryName = platform => platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'
const normalizeArch = arch => {
  if (arch === 'ia32' || arch === 'x86') return 'ia32'
  if (arch === 'x86_64') return 'x64'
  if (arch === 'armv7l' || arch === 'arm') return 'armv7l'
  return arch
}

const rustTargetMap = {
  win32: {
    x64: 'x86_64-pc-windows-msvc',
    ia32: 'i686-pc-windows-msvc',
    arm64: 'aarch64-pc-windows-msvc',
  },
  darwin: {
    x64: 'x86_64-apple-darwin',
    arm64: 'aarch64-apple-darwin',
  },
  linux: {
    x64: 'x86_64-unknown-linux-gnu',
    arm64: 'aarch64-unknown-linux-gnu',
    armv7l: 'armv7-unknown-linux-gnueabihf',
  },
}

const getRustTarget = (platform, arch) => rustTargetMap[platform]?.[normalizeArch(arch)] ?? null
const supportedNativeTargets = {
  win32: new Set(['x64']),
  darwin: new Set(['x64', 'arm64']),
  linux: new Set(['x64']),
}

const getVst3HostPlan = (platform = process.platform, arch = process.arch) => {
  const targetArch = normalizeArch(arch)
  const buildArch = normalizeArch(process.arch)
  const name = hostBinaryName(platform)
  const rustTarget = getRustTarget(platform, targetArch)
  const win7Disabled = platform === 'win32' && process.env.BUILD_WIN7 === 'true'
  const supported = !win7Disabled && !!rustTarget && supportedNativeTargets[platform]?.has(targetArch) === true && platform === process.platform && targetArch === buildArch
  return {
    platform,
    arch: targetArch,
    name,
    rustTarget,
    supported,
    reason: win7Disabled
      ? 'VST3 host is disabled for the Windows 7 compatibility package'
      : supported ? '' : `VST3 host cross-build is not configured for ${platform}-${targetArch} on ${process.platform}-${buildArch}`,
    sourcePath: path.join(root, 'build/Release', name),
  }
}

const mapPeMachine = machine => ({
  0x014c: 'ia32',
  0x8664: 'x64',
  0xaa64: 'arm64',
}[machine])

const mapElfMachine = machine => ({
  3: 'ia32',
  40: 'armv7l',
  62: 'x64',
  183: 'arm64',
}[machine])

const mapMachCpuType = cpuType => ({
  7: 'ia32',
  12: 'armv7l',
  0x01000007: 'x64',
  0x0100000c: 'arm64',
}[cpuType])

const getBinaryArchitectures = (filePath, platform) => {
  const data = fs.readFileSync(filePath)
  if (platform === 'win32') {
    if (data.length < 0x40 || data[0] !== 0x4d || data[1] !== 0x5a) return []
    const peOffset = data.readUInt32LE(0x3c)
    if (
      peOffset + 6 > data.length ||
      data[peOffset] !== 0x50 || data[peOffset + 1] !== 0x45 ||
      data[peOffset + 2] !== 0 || data[peOffset + 3] !== 0
    ) return []
    const arch = mapPeMachine(data.readUInt16LE(peOffset + 4))
    return arch ? [arch] : []
  }

  if (platform === 'linux') {
    if (data.length < 20 || data[0] !== 0x7f || data.toString('ascii', 1, 4) !== 'ELF') return []
    const machine = data[5] === 1
      ? data.readUInt16LE(18)
      : data[5] === 2 ? data.readUInt16BE(18) : null
    const arch = machine == null ? null : mapElfMachine(machine)
    return arch ? [arch] : []
  }

  if (platform === 'darwin') {
    if (data.length < 8) return []
    const magicBE = data.readUInt32BE(0)
    const magicLE = data.readUInt32LE(0)
    const fat = magicBE === 0xcafebabe || magicLE === 0xcafebabe
    if (fat) {
      const littleEndian = magicLE === 0xcafebabe
      const read32 = littleEndian ? data.readUInt32LE.bind(data) : data.readUInt32BE.bind(data)
      const readCpu = littleEndian ? data.readInt32LE.bind(data) : data.readInt32BE.bind(data)
      const count = read32(4)
      const architectures = []
      for (let index = 0; index < count; index++) {
        const offset = 8 + index * 20
        if (offset + 4 > data.length) break
        const arch = mapMachCpuType(readCpu(offset))
        if (arch && !architectures.includes(arch)) architectures.push(arch)
      }
      return architectures
    }

    const littleEndian = [0xfeedface, 0xfeedfacf].includes(magicLE)
    const bigEndian = [0xfeedface, 0xfeedfacf].includes(magicBE)
    if (!littleEndian && !bigEndian) return []
    const cpuType = littleEndian ? data.readInt32LE(4) : data.readInt32BE(4)
    const arch = mapMachCpuType(cpuType)
    return arch ? [arch] : []
  }

  return []
}

const validateVst3HostBinary = (filePath, platform, arch) => {
  const targetArch = normalizeArch(arch)
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    throw new Error(`VST3 host binary is missing: ${filePath}`)
  }
  if (!stat.isFile()) throw new Error(`VST3 host path is not a file: ${filePath}`)
  if (platform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`VST3 host binary is not executable: ${filePath}`)
  }
  const architectures = getBinaryArchitectures(filePath, platform)
  if (!architectures.length) throw new Error(`VST3 host binary format is invalid for ${platform}: ${filePath}`)
  if (!architectures.includes(targetArch)) {
    throw new Error(`VST3 host binary architecture mismatch: expected ${platform}-${targetArch}, got ${architectures.join(',')}`)
  }
  return { filePath, platform, arch: targetArch, architectures }
}

const buildVst3Host = (platform = process.platform, arch = process.arch) => {
  const plan = getVst3HostPlan(platform, arch)
  if (!plan.supported) throw new Error(plan.reason)
  const cargoArgs = ['build', '--release', '--locked']
  if (plan.rustTarget) cargoArgs.push('--target', plan.rustTarget)
  const result = spawnSync('cargo', cargoArgs, { cwd, stdio: 'inherit', shell: false })
  if (result.error?.code === 'ENOENT') {
    throw new Error('Rust toolchain (cargo) is required to build the VST3 host: https://rustup.rs')
  }
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`VST3 host build failed with exit code ${result.status}`)
  const releaseDir = plan.rustTarget ? path.join(cwd, 'target', plan.rustTarget, 'release') : path.join(cwd, 'target/release')
  const builtPath = path.join(releaseDir, plan.name)
  if (!fs.existsSync(builtPath)) throw new Error(`VST3 host build completed without ${builtPath}`)
  validateVst3HostBinary(builtPath, plan.platform, plan.arch)
  fs.mkdirSync(path.dirname(plan.sourcePath), { recursive: true })
  fs.copyFileSync(builtPath, plan.sourcePath)
  validateVst3HostBinary(plan.sourcePath, plan.platform, plan.arch)
  return plan.sourcePath
}

if (require.main === module) {
  const params = Object.fromEntries(process.argv.slice(2).map(value => value.split('=')))
  buildVst3Host(params.platform ?? process.platform, params.arch ?? process.arch)
}

module.exports = {
  buildVst3Host,
  getVst3HostPlan,
  getRustTarget,
  getBinaryArchitectures,
  validateVst3HostBinary,
  hostBinaryName: hostBinaryName(process.platform),
}
