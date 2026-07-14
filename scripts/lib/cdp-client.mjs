import http from 'http'
import WebSocket from 'ws'

/**
 * 共享 CDP（Chrome DevTools Protocol）客户端辅助模块。
 * 供本地调试脚本复用，用于连接 Electron 的 Node/V8 inspector，
 * 并在 renderer 或 main process 中执行 JavaScript。
 */

const DEFAULT_PORT = 5858

/**
 * 获取 CDP WebSocket 调试 URL
 * @param {number} [port=5858]
 * @returns {Promise<string>}
 */
export function getWsUrl(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const list = JSON.parse(data)
          const item = list.find(x => x.type === 'node') || list[0]
          if (!item || !item.webSocketDebuggerUrl) {
            throw new Error('no debugger target found')
          }
          resolve(item.webSocketDebuggerUrl)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

/**
 * 发送 CDP 命令并等待对应 id 的响应
 * @param {WebSocket} ws
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>}
 */
export function send(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (buf) => {
      let data
      try {
        data = JSON.parse(buf.toString())
      } catch {
        return
      }
      if (data.id !== id) return
      ws.off('message', handler)
      if (data.error) reject(data.error)
      else resolve(data.result)
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * 连接到 CDP 端点，自动启用 Runtime，返回 ws 实例
 * @param {number} [port=5858]
 * @returns {Promise<WebSocket>}
 */
export async function connect(port = DEFAULT_PORT) {
  const wsUrl = await getWsUrl(port)
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  await send(ws, 'Runtime.enable', {})
  return ws
}

/**
 * 在 renderer 进程中执行 JS 代码
 * 通过 main process 的 BrowserWindow 调用 webContents.executeJavaScript
 * @param {WebSocket} ws
 * @param {string} code
 * @returns {Promise<any>}
 */
export function runInRenderer(ws, code) {
  // CDP Runtime.evaluate 默认 context 里没有 require，但 process.mainModule.require 可用
  const expression = `
    (() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows().find(w => w.id === 1);
      return win.webContents.executeJavaScript(${JSON.stringify(code)}, true);
    })()
  `
  return send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then(result => result.result?.value)
}

/**
 * 在 main process 中执行 JS 代码
 * @param {WebSocket} ws
 * @param {string} code
 * @returns {Promise<any>}
 */
export function runInMain(ws, code) {
  const expression = `
    (() => {
      return (${code})();
    })()
  `
  return send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then(result => result.result?.value)
}

/**
 * 安全关闭 CDP 连接
 * @param {WebSocket} ws
 */
export function close(ws) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close()
  }
}
