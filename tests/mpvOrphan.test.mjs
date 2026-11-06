import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// #12：mpv 孤儿进程防护。主进程退出（含异常退出 / 终止信号）时结束已登记的 mpv 子进程；
// 启动时只清理「主进程已不存在」的本应用 mpv 及其残留文件，不影响用户自己的 mpv。

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@common/utils') return { url: `data:text/javascript,${encodeURIComponent('export const log = { info() {}, warn() {}, error() {} }')}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const orphan = await import('../src/main/modules/winMain/mpvOrphan.ts')
const { parseMpvOwnerPid, findOrphanMpvProcesses, parseWindowsProcessJson, parsePsOutput, cleanupOrphanMpvProcesses, isProcessAlive, listMpvProcesses } = orphan

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitUntil = async(cond, timeout = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (cond()) return true; await sleep(50) }
  return cond()
}
const spawnSleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
const deadPid = () => { let pid = 4_000_000; while (isProcessAlive(pid)) pid++; return pid }

test('parseMpvOwnerPid only recognises mpv started by LX (Windows pipe and POSIX socket forms)', () => {
  assert.equal(parseMpvOwnerPid('"C:\\mpv\\mpv.exe" --idle=yes --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-1234-2 --no-video'), 1234)
  assert.equal(parseMpvOwnerPid('/opt/homebrew/bin/mpv --idle=yes --input-ipc-server=/var/folders/x/T/lx-music-mpv-555-1.sock'), 555)
  assert.equal(parseMpvOwnerPid('mpv --input-ipc-server="/tmp/a b/lx-music-mpv-77-3.sock" --idle=yes'), 77)
  assert.equal(parseMpvOwnerPid('mpv --idle=yes movie.mkv'), null, 'user-launched mpv')
  assert.equal(parseMpvOwnerPid('mpv --input-ipc-server=/tmp/mpvsocket'), null, 'mpv with another IPC name')
  assert.equal(parseMpvOwnerPid('node script.js lx-music-mpv-1-1'), null, 'not an mpv process')
})

test('findOrphanMpvProcesses selects only LX mpv whose owner process is gone', () => {
  const list = [
    { pid: 10, command: 'mpv --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-900-1' }, // owner 900 dead → orphan
    { pid: 11, command: 'mpv --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-901-1' }, // owner 901 alive (another LX instance)
    { pid: 12, command: 'mpv --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-1000-4' }, // owned by current process
    { pid: 13, command: 'mpv --idle=yes song.flac' }, // user mpv
  ]
  const orphans = findOrphanMpvProcesses(list, { currentPid: 1000, isAlive: pid => pid === 901 })
  assert.deepEqual(orphans.map(p => p.pid), [10])
})

test('process list parsers handle PowerShell JSON (object / array / null command line) and ps output', () => {
  assert.deepEqual(parseWindowsProcessJson('{"ProcessId":5,"CommandLine":"mpv.exe --idle"}'), [{ pid: 5, command: 'mpv.exe --idle' }])
  assert.deepEqual(parseWindowsProcessJson('[{"ProcessId":5,"CommandLine":"a"},{"ProcessId":6,"CommandLine":null}]'), [{ pid: 5, command: 'a' }])
  assert.deepEqual(parseWindowsProcessJson('  '), [])
  assert.deepEqual(parsePsOutput('  101 /usr/bin/mpv --idle=yes\n  102 bash\n\n'), [{ pid: 101, command: '/usr/bin/mpv --idle=yes' }, { pid: 102, command: 'bash' }])
})

test('cleanupOrphanMpvProcesses kills only orphans, removes stale files, and never throws', async() => {
  const killed = []
  const removed = []
  const result = await cleanupOrphanMpvProcesses({
    currentPid: 1000,
    isAlive: pid => pid === 901,
    listProcesses: async() => [
      { pid: 10, command: 'mpv --input-ipc-server=/tmp/lx-music-mpv-900-1.sock' },
      { pid: 11, command: 'mpv --input-ipc-server=/tmp/lx-music-mpv-901-1.sock' },
      { pid: 14, command: 'mpv --input-ipc-server=/tmp/lx-music-mpv-902-1.sock' }, // 结束失败
    ],
    kill: pid => { if (pid === 14) throw new Error('EPERM'); killed.push(pid) },
    tmpDir: '/tmp',
    readdir: () => ['lx-music-mpv-900-1.sock', 'lx-music-video-900-2.conf', 'lx-music-mpv-901-1.sock', 'lx-music-mpv-1000-1.sock', 'other.sock'],
    unlink: file => { removed.push(file.replace(/\\/g, '/')) },
  })
  assert.deepEqual(killed, [10])
  assert.deepEqual(result.killed, [10])
  assert.deepEqual(removed, ['/tmp/lx-music-mpv-900-1.sock', '/tmp/lx-music-video-900-2.conf'])

  // 进程列表获取失败时仍清理残留文件
  const second = await cleanupOrphanMpvProcesses({ currentPid: 1000, isAlive: () => false, listProcesses: async() => { throw new Error('ps not found') }, kill: () => {}, tmpDir: '/tmp', readdir: () => ['lx-music-mpv-5-1.sock'], unlink: () => {} })
  assert.deepEqual(second, { killed: [], removedFiles: ['lx-music-mpv-5-1.sock'] })
})

test('#12 startup cleanup terminates a real orphan but leaves a live owner\'s mpv and user mpv running', async() => {
  const orphanProc = spawnSleeper()
  const liveOwnedProc = spawnSleeper()
  const userProc = spawnSleeper()
  try {
    const dead = deadPid()
    const result = await cleanupOrphanMpvProcesses({
      listProcesses: async() => [
        { pid: orphanProc.pid, command: `mpv --idle=yes --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-${dead}-1` },
        { pid: liveOwnedProc.pid, command: `mpv --idle=yes --input-ipc-server=\\\\.\\pipe\\lx-music-mpv-${process.ppid}-1` },
        { pid: userProc.pid, command: 'mpv --idle=yes song.flac' },
      ],
      readdir: () => [],
    })
    assert.deepEqual(result.killed, [orphanProc.pid])
    assert.ok(await waitUntil(() => !isProcessAlive(orphanProc.pid)), 'orphan must be terminated')
    assert.equal(isProcessAlive(liveOwnedProc.pid), true)
    assert.equal(isProcessAlive(userProc.pid), true)
  } finally {
    for (const proc of [orphanProc, liveOwnedProc, userProc]) { try { proc.kill() } catch {} }
  }
})

test('#12 listing real mpv processes works on this platform (returns an array)', async() => {
  const list = await listMpvProcesses()
  assert.ok(Array.isArray(list))
})

const runParent = async mode => {
  const fixture = fileURLToPath(new URL('./fixtures/mpvOrphanParent.mjs', import.meta.url))
  const parent = spawn(process.execPath, ['--no-warnings', fixture, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  parent.stdout.on('data', chunk => { output += chunk })
  const exited = new Promise(resolve => parent.once('exit', (code, signal) => resolve({ code, signal })))
  assert.ok(await waitUntil(() => /CHILD (\d+)/.test(output), 10000), 'fixture did not report its child')
  const childPid = Number(/CHILD (\d+)/.exec(output)[1])
  assert.equal(isProcessAlive(childPid), true)
  return { parent, exited, childPid }
}

test('#12 when the main process crashes (uncaught exception), registered mpv children are terminated with it', { timeout: 20_000 }, async() => {
  const { exited, childPid } = await runParent('crash')
  const { code } = await exited
  assert.notEqual(code, 0, 'parent crashed')
  const gone = await waitUntil(() => !isProcessAlive(childPid))
  if (!gone) try { process.kill(childPid) } catch {}
  assert.ok(gone, `child ${childPid} must not survive the crashed main process`)
})

test('#12 when the main process receives SIGTERM, registered mpv children are terminated first', { timeout: 20_000, skip: process.platform === 'win32' ? 'Windows has no catchable SIGTERM (TerminateProcess); covered by the startup cleanup' : false }, async() => {
  const { parent, exited, childPid } = await runParent('signal')
  parent.kill('SIGTERM')
  const { code } = await exited
  assert.equal(code, 143)
  const gone = await waitUntil(() => !isProcessAlive(childPid))
  if (!gone) try { process.kill(childPid) } catch {}
  assert.ok(gone, `child ${childPid} must not survive SIGTERM of the main process`)
})
