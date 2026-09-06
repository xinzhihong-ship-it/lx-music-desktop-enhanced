const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  getVst3HostPlan,
  getRustTarget,
  getBinaryArchitectures,
  validateVst3HostBinary,
} = require('../build-config/build-vst3-host')

test('native VST3 host plans only advertise matching native builds', () => {
  const native = getVst3HostPlan(process.platform, process.arch)
  if (process.arch !== 'arm') assert.equal(native.supported, true)
  assert.match(native.name, process.platform === 'win32' ? /\.exe$/ : /^lx-vst3-host$/)

  const cross = getVst3HostPlan('linux', 'arm64')
  if (process.platform !== 'linux' || process.arch !== 'arm64') assert.equal(cross.supported, false)

  const win32 = getVst3HostPlan('win32', 'x86')
  if (process.platform !== 'win32' || !['ia32', 'x86'].includes(process.arch)) assert.equal(win32.supported, false)
})

test('unsupported target plans never reuse a stale host binary', () => {
  const plan = getVst3HostPlan('linux', 'armv7l')
  assert.equal(plan.supported, false)
  assert.match(plan.reason, /cross-build is not configured/)
  assert.match(plan.sourcePath, /build[\\/]Release[\\/]lx-vst3-host$/)
})

test('native host plans carry an explicit Rust target', () => {
  assert.equal(getRustTarget('darwin', 'arm64'), 'aarch64-apple-darwin')
  assert.equal(getRustTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu')
  assert.equal(getRustTarget('win32', 'x86'), 'i686-pc-windows-msvc')
})

test('packaged host validation checks format, architecture and executable mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-vst3-package-test-'))
  try {
    const elf = Buffer.alloc(64)
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0)
    elf.writeUInt16LE(62, 18)
    const elfPath = path.join(root, 'lx-vst3-host')
    fs.writeFileSync(elfPath, elf, { mode: 0o755 })
    assert.deepEqual(getBinaryArchitectures(elfPath, 'linux'), ['x64'])
    // Windows does not preserve POSIX executable bits on synthetic ELF files.
    if (process.platform !== 'win32') {
      assert.equal(validateVst3HostBinary(elfPath, 'linux', 'x64').arch, 'x64')
      assert.throws(() => validateVst3HostBinary(elfPath, 'linux', 'arm64'), /architecture mismatch/)
    }

    const pe = Buffer.alloc(0x80)
    pe[0] = 0x4d
    pe[1] = 0x5a
    pe.writeUInt32LE(0x40, 0x3c)
    pe.set([0x50, 0x45, 0, 0], 0x40)
    pe.writeUInt16LE(0x8664, 0x44)
    const pePath = path.join(root, 'lx-vst3-host.exe')
    fs.writeFileSync(pePath, pe)
    assert.deepEqual(getBinaryArchitectures(pePath, 'win32'), ['x64'])
    assert.equal(validateVst3HostBinary(pePath, 'win32', 'x64').arch, 'x64')
    assert.throws(() => validateVst3HostBinary(pePath, 'win32', 'arm64'), /architecture mismatch/)

    const mach = Buffer.alloc(32)
    mach.set([0xcf, 0xfa, 0xed, 0xfe], 0)
    mach.writeInt32LE(0x0100000c, 4)
    const machPath = path.join(root, 'lx-vst3-host-mac')
    fs.writeFileSync(machPath, mach, { mode: 0o755 })
    assert.deepEqual(getBinaryArchitectures(machPath, 'darwin'), ['arm64'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('post-pack validation rejects stale unsupported hosts and accepts native hosts', async() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-vst3-after-pack-test-'))
  const context = {
    electronPlatformName: 'linux',
    arch: 'arm64',
    appOutDir: root,
    packager: { appInfo: { productFilename: 'lx-music-desktop' } },
  }
  const hostPath = path.join(root, 'resources/bin/lx-vst3-host')
  try {
    fs.mkdirSync(path.dirname(hostPath), { recursive: true })
    fs.writeFileSync(hostPath, 'stale host')
    const afterPack = require('../build-config/build-after-pack')
    await assert.rejects(afterPack(context), /unexpectedly contains/)
    fs.rmSync(hostPath)
    await afterPack(context)

    if (process.platform !== 'darwin') {
      const nativeContext = {
        ...context,
        electronPlatformName: process.platform,
        arch: process.arch,
      }
      const nativeHostPath = path.join(root, 'resources/bin', process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host')
      fs.copyFileSync(process.execPath, nativeHostPath)
      fs.chmodSync(nativeHostPath, 0o755)
      await afterPack(nativeContext)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
