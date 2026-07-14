import { connect, send, close } from './scripts/lib/cdp-client.mjs'

/**
 * CDP 连接测试示例：连接 inspector，启用 Runtime，
 * 在 main process 中通过 BrowserWindow 在 renderer 中执行一段 JS。
 */

async function main() {
  const ws = await connect()
  console.log('Connected')

  // 在 main process 中执行；CDP Runtime.evaluate 默认 context 里没有 require，
  // 但 process.mainModule.require 可用。
  const expression = `
    (() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        "(() => { return { title: document.title, url: location.href, keys: Object.keys(window).slice(0,20) }; })()",
        true
      );
    })()
  `
  const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  console.log('Result:', JSON.stringify(result, null, 2))

  close(ws)
}

main().catch(e => { console.error(e); process.exit(1) })
