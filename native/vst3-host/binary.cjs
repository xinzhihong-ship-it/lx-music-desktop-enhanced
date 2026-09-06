const fs = require('node:fs')

const normalizeArch = arch => {
  if (arch === 'ia32' || arch === 'x86') return 'ia32'
  if (arch === 'x86_64') return 'x64'
  if (arch === 'armv7l' || arch === 'arm') return 'armv7l'
  return arch
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

module.exports = { getBinaryArchitectures, validateVst3HostBinary, normalizeArch }
