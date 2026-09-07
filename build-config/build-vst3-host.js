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
// Windows and Linux release jobs build x64 hosts plus their ARM targets from the native x64
// runner. macOS stays native because the package also needs an architecture-matched native
// editor/runtime environment.
const supportedNativeTargets = {
  win32: new Set(['x64', 'arm64']),
  darwin: new Set(['x64', 'arm64']),
  linux: new Set(['x64', 'arm64', 'armv7l']),
}

const linuxCrossToolchains = {
  arm64: {
    linker: 'aarch64-linux-gnu-gcc',
    pkgConfigDir: '/usr/lib/aarch64-linux-gnu/pkgconfig',
  },
  armv7l: {
    linker: 'arm-linux-gnueabihf-gcc',
    pkgConfigDir: '/usr/lib/arm-linux-gnueabihf/pkgconfig',
  },
}

const getCargoBuildEnvironment = (platform, arch) => {
  const env = { ...process.env }
  if (platform !== 'linux' || !linuxCrossToolchains[arch] || normalizeArch(process.arch) === normalizeArch(arch)) return env

  const toolchain = linuxCrossToolchains[arch]
  const target = normalizeArch(arch) === 'arm64'
    ? 'AARCH64_UNKNOWN_LINUX_GNU'
    : 'ARMV7_UNKNOWN_LINUX_GNUEABIHF'
  env[`CARGO_TARGET_${target}_LINKER`] ??= toolchain.linker
  // The xcb crate links the target system's libxcb. Keep pkg-config from accidentally selecting
  // the host x64 metadata when a cross build is running on Ubuntu x64.
  env.PKG_CONFIG_ALLOW_CROSS ??= '1'
  env.PKG_CONFIG_LIBDIR ??= `${toolchain.pkgConfigDir}${path.delimiter}/usr/share/pkgconfig`
  env.PKG_CONFIG_PATH ??= env.PKG_CONFIG_LIBDIR
  return env
}

const getVst3HostPlan = (platform = process.platform, arch = process.arch) => {
  const targetArch = normalizeArch(arch)
  const buildArch = normalizeArch(process.arch)
  const name = hostBinaryName(platform)
  const rustTarget = getRustTarget(platform, targetArch)
  const win7Disabled = platform === 'win32' && process.env.BUILD_WIN7 === 'true'
  const targetSupported = !!rustTarget && supportedNativeTargets[platform]?.has(targetArch) === true
  // Windows/Linux CI runners have the native toolchains needed for the listed ARM targets.
  // Keep macOS architecture matching strict because the rest of the native packaging pipeline
  // (notably the mpv bridge) is also native-only.
  const architectureSupported = platform !== 'darwin' || targetArch === buildArch
  const supported = !win7Disabled && targetSupported && platform === process.platform && architectureSupported
  return {
    platform,
    arch: targetArch,
    name,
    rustTarget,
    supported,
    reason: win7Disabled
      ? 'VST3 host is disabled for the Windows 7 compatibility package'
      : supported ? '' : `VST3 host build is unavailable for ${platform}-${targetArch} on ${process.platform}-${buildArch}`,
    sourcePath: path.join(root, 'build/Release', name),
  }
}

const buildVst3Host = (platform, arch) => {
  if (!platform || !arch) throw new Error('VST3 host build requires an explicit target platform and architecture')
  const plan = getVst3HostPlan(platform, arch)
  if (!plan.supported) throw new Error(plan.reason)
  const cargoArgs = ['build', '--release', '--locked']
  if (plan.rustTarget) cargoArgs.push('--target', plan.rustTarget)
  const result = spawnSync('cargo', cargoArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: getCargoBuildEnvironment(plan.platform, plan.arch),
  })
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
  getCargoBuildEnvironment,
  getBinaryArchitectures,
  validateVst3HostBinary,
  hostBinaryName: hostBinaryName(process.platform),
}
