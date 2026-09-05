// Run with Electron, not Node: npm run test:vst3:audio.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { Vst3Chain } = require('../native/vst3-host/chain.cjs')

let chain
let root
let finished = false
async function finish(error, result) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  try { await chain?.close() } catch (failure) { error ||= failure.message }
  if (root) await fs.rm(root, { recursive: true, force: true })
  console.log(JSON.stringify(error ? { error } : result))
  app.exit(error ? 1 : 0)
}
const deadline = setTimeout(() => { void finish('Realtime audio test timed out') }, 20000)
app.whenReady().then(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-vst3-audio-'))
  const name = process.platform === 'win32' ? 'lx-vst3-host.exe' : 'lx-vst3-host'
  chain = new Vst3Chain(path.resolve('native/vst3-host/target/debug', name), root)
  const saveTimer = setInterval(() => {
    void chain.save().catch(error => { void finish(error.message) })
  }, 5000)
  app.once('before-quit', () => clearInterval(saveTimer))
  ipcMain.handle('configure', async (_, sampleRate) => {
    const plugin = process.env.LX_VST3_TEST_PLUGIN
    return chain.configure(plugin ? [{ id: randomUUID(), path: plugin, enabled: true }] : [], sampleRate, new Set([plugin]))
  })
  ipcMain.handle('process', async (_, inputs) => chain.process(inputs))
  ipcMain.on('result', (_, result) => { void finish(result.error, result) })
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  window.webContents.on('render-process-gone', () => { void finish('Audio renderer crashed') })
  await window.loadFile(path.join(__dirname, 'vst3-audio.html'))
}).catch(error => { void finish(error.message) })
