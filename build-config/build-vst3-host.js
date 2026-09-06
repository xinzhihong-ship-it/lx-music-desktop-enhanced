const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { getBinaryArchitectures, validateVst3HostBinary, normalizeArch } = require('../native/vst3-host/binary.cjs')

const root = path.resolve(__dirname, '..')
const cwd = path.join(root, 'native/vst3-host')

const hostBinaryName = platform => platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'

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

const buildVst3Host = (platform, arch) => {
  if (!platform || !arch) throw new Error('VST3 host build requires an explicit target platform and architecture')
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
