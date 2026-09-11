/**
 * 验证基调音频分片能否安全穿过 Electron IPC。
 *
 * 渲染进程的分析模块依赖 `Uint8Array` 经结构化克隆后仍是 `Uint8Array`；
 * 单元测试里 ipc 是假的，覆盖不到这一点，所以单独跑一次真实 IPC 往返。
 * 用 `npx electron tests/songKeyIpc.test.cjs` 执行。
 */
const { app, BrowserWindow, ipcMain } = require('electron')

const SIZE = 512 * 1024

app.whenReady().then(async() => {
  const payload = new Uint8Array(SIZE)
  for (let i = 0; i < SIZE; i++) payload[i] = i & 0xff

  ipcMain.handle('test:fetch-audio', () => ({
    bytes: payload,
    totalBytes: SIZE,
    truncated: true,
  }))

  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  })
  await win.loadURL('data:text/html,<html><body>ipc</body></html>')

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const { ipcRenderer } = require('electron')
      const r = await ipcRenderer.invoke('test:fetch-audio')
      const b = r && r.bytes
      return {
        isUint8Array: b instanceof Uint8Array,
        isArrayBuffer: b instanceof ArrayBuffer,
        isArray: Array.isArray(b),
        ctor: b && b.constructor ? b.constructor.name : String(b),
        length: b ? b.length : -1,
        first: b ? b[0] : -1,
        last: b ? b[b.length - 1] : -1,
        totalBytes: r ? r.totalBytes : -1,
        truncated: r ? r.truncated : null,
      }
    })()
  `)

  const ok = result.isUint8Array &&
    result.length === SIZE &&
    result.first === 0 &&
    result.last === 255 &&
    result.totalBytes === SIZE &&
    result.truncated === true

  console.log(JSON.stringify({ ok, ...result }))
  win.destroy()
  app.exit(ok ? 0 : 1)
}).catch((err) => {
  console.error('test crashed:', err)
  app.exit(1)
})
