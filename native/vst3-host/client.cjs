const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

const MAX_MESSAGE = 32 * 1024 * 1024

// One helper per plugin. A crash or timeout invalidates that instance and its pending request.
async function startHost(executable, timeout = 15000) {
  const token = randomBytes(32).toString('hex')
  const server = net.createServer()
  let child
  let socket
  let pending
  let failed
  const peers = new Set()
  const close = (error = new Error('VST3 host closed')) => {
    if (failed) return
    failed = error
    process.removeListener('exit', onExit)
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      pending = null
    }
    for (const peer of peers) peer.destroy()
    server.close()
    child?.kill()
  }
  const onExit = () => close()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('VST3 host startup timeout')), timeout)
      const fail = error => {
        clearTimeout(timer)
        close(error)
        reject(error)
      }
      server.on('connection', peer => {
        peers.add(peer)
        peer.setNoDelay(true)
        peer.setTimeout(timeout, () => peer.destroy())
        let buffer = Buffer.alloc(0)
        let authenticated = false
        let expectBinary = 0
        peer.on('error', error => { if (authenticated) fail(error) })
        peer.on('close', () => {
          peers.delete(peer)
          if (authenticated) fail(new Error('VST3 host disconnected'))
        })
        peer.on('data', chunk => {
          buffer = Buffer.concat([buffer, chunk])
          if (buffer.length > MAX_MESSAGE) {
            if (authenticated) fail(new Error('VST3 response too large'))
            else peer.destroy()
            return
          }
          while (true) {
            if (expectBinary > 0) {
              if (buffer.length < expectBinary) return
              const payload = buffer.subarray(0, expectBinary)
              buffer = buffer.subarray(expectBinary)
              expectBinary = 0
              const request = pending
              pending = null
              clearTimeout(request.timer)
              if (request.header?.ok === true) request.resolve({ result: request.header.result, payload })
              else request.reject(new Error(typeof request.header?.error === 'string' ? request.header.error : 'Invalid VST3 response'))
              continue
            }
            const end = buffer.indexOf('\n')
            if (end === -1) return
            const line = buffer.subarray(0, end).toString('utf8')
            buffer = buffer.subarray(end + 1)
            let response
            try { response = JSON.parse(line) } catch {
              if (authenticated) fail(new Error('Invalid VST3 response'))
              else peer.destroy()
              return
            }
            if (!authenticated) {
              if (socket || response?.token !== token) { peer.destroy(); return }
              authenticated = true
              socket = peer
              peer.setTimeout(0)
              server.close()
              clearTimeout(timer)
              resolve()
            } else if (pending) {
              const binaryBytes = Number(response?.result?.binary_bytes)
              if (response?.ok === true && Number.isInteger(binaryBytes) && binaryBytes > 0 && binaryBytes <= MAX_MESSAGE) {
                pending.header = response
                expectBinary = binaryBytes
                continue
              }
              const request = pending
              pending = null
              clearTimeout(request.timer)
              if (response?.ok === true) request.resolve(response.result)
              else request.reject(new Error(typeof response?.error === 'string' ? response.error : 'Invalid VST3 response'))
            } else {
              fail(new Error('Unsolicited VST3 response'))
              return
            }
          }
        })
      })
      child = spawn(executable, ['--connect', `127.0.0.1:${server.address().port}`, token], {
        stdio: 'ignore', windowsHide: true, shell: false,
      })
      child.once('error', fail)
      child.once('exit', (code, signal) => fail(new Error(`VST3 host exited (${signal || code})`)))
      process.once('exit', onExit)
    })
  } catch (error) {
    close(error)
    throw error
  }
  return {
    pid: child.pid,
    get closed() { return !!failed },
    close,
    request(command, binaryPayload) {
      if (failed) return Promise.reject(failed)
      if (pending) return Promise.reject(new Error('VST3 request already in progress'))
      const header = JSON.stringify(command) + '\n'
      if (Buffer.byteLength(header) > MAX_MESSAGE) return Promise.reject(new Error('VST3 request too large'))
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => close(new Error('VST3 request timeout')), timeout) }
        socket.write(header, error => { if (error) { close(error); return } })
        if (binaryPayload) socket.write(binaryPayload, error => { if (error) close(error) })
      })
    },
  }
}

function defaultDirectories(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') return ['/Library/Audio/Plug-Ins/VST3', path.posix.join(home, 'Library/Audio/Plug-Ins/VST3')]
  if (platform === 'win32') return [path.win32.join(env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3'),
    ...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, 'Programs/Common/VST3')] : [])]
  if (platform === 'linux') return [path.posix.join(home, '.vst3'), '/usr/lib/vst3', '/usr/local/lib/vst3']
  return []
}

async function findPlugins(directories) {
  if (!Array.isArray(directories) || directories.length > 136 || directories.some(dir => typeof dir !== 'string' || !path.isAbsolute(dir))) {
    throw new Error('Expected absolute paths: up to 128 custom directories plus system VST3 directories')
  }
  const plugins = new Set()
  const visited = new Set()
  const warnings = []
  let scanLimitReached = false
  const visit = async directory => {
    if (scanLimitReached) return
    try {
      const real = await fs.realpath(directory)
      if (visited.has(real)) return
      visited.add(real)
      if (visited.size > 20000) {
        scanLimitReached = true
        throw new Error('VST3 directory scan limit exceeded')
      }
      const stat = await fs.stat(real)
      if (path.extname(real).toLowerCase() === '.vst3') {
        plugins.add(real)
        return
      }
      if (!stat.isDirectory()) throw new Error('Not a directory')
      for (const item of await fs.readdir(real, { withFileTypes: true })) {
        if (item.isDirectory() || item.isSymbolicLink() || path.extname(item.name).toLowerCase() === '.vst3') {
          await visit(path.join(real, item.name))
        }
      }
    } catch (error) { warnings.push({ path: directory, error: error.message }) }
  }
  for (const directory of directories) await visit(directory)
  return { paths: [...plugins].sort(), warnings }
}

async function scanPlugins(executable, directories) {
  const { paths, warnings } = await findPlugins(directories)
  const plugins = []
  for (const candidate of paths) {
    let host
    try {
      host = await startHost(executable)
      plugins.push({ path: candidate, details: await host.request({ command: 'probe', path: candidate }) })
    } catch (error) { warnings.push({ path: candidate, error: error.message }) }
    finally { host?.close() }
  }
  return { plugins, warnings }
}

module.exports = { startHost, defaultDirectories, findPlugins, scanPlugins }
