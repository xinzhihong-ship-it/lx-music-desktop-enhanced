// 手动调试脚本，需先以 --inspect 启动应用，不参与自动化测试。
import { connect, send, close } from '../lib/cdp-client.mjs'

/**
 * 在仓库根目录运行 npm run dev，等待应用主窗口打开（主进程监听 127.0.0.1:5858）。
 * 在另一个终端从仓库根目录运行 node scripts/dev/cdp-connect.mjs。
 * 脚本会连接主进程的 inspector，并输出主窗口的标题、URL 和部分 window 属性。
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
