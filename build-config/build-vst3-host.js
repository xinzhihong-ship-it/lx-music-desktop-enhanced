const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cwd = path.join(root, 'native/vst3-host')
const name = process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'

const buildVst3Host = () => {
  const result = spawnSync('cargo', ['build', '--release', '--locked'], { cwd, stdio: 'inherit', shell: false })
  if (result.error?.code === 'ENOENT') {
    throw new Error('Rust toolchain (cargo) is required to build the VST3 host: https://rustup.rs')
  }
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
  fs.mkdirSync(path.join(root, 'build/Release'), { recursive: true })
  fs.copyFileSync(path.join(cwd, 'target/release', name), path.join(root, 'build/Release', name))
}

if (require.main === module) buildVst3Host()

module.exports = { buildVst3Host, hostBinaryName: name }
