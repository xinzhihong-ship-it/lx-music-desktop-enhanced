// 手动调试脚本，需先以 --inspect 启动应用，不参与自动化测试。
import { connect, close } from '../lib/cdp-client.mjs'
import {
  openAccountModal,
  selectPlatform,
  selectMethod,
  fillPhone,
  clickSendCode,
  readModalError,
  readModalBody,
} from '../lib/account-modal.mjs'

/**
 * 在仓库根目录运行 npm run dev，等待应用主窗口打开（主进程监听 127.0.0.1:5858）。
 * 将 main() 中的示例手机号替换为获准接收测试短信的号码，再运行 node scripts/dev/account-modal-sms.mjs。
 * 脚本会依次在酷狗音乐、QQ 音乐的登录弹窗中点击发送验证码，并输出弹窗内容与错误。
 */

async function testPlatformSms(ws, platformName, phone) {
  console.log(`\n--- Testing ${platformName} SMS ---`)
  await openAccountModal(ws)
  await selectPlatform(ws, platformName)
  await selectMethod(ws, '短信')
  await fillPhone(ws, phone)
  await clickSendCode(ws)
  await new Promise(r => setTimeout(r, 3000))

  const error = await readModalError(ws)
  const body = await readModalBody(ws, 350)
  console.log('result:', JSON.stringify({ error, body }, null, 2))
}

async function main() {
  const ws = await connect()
  await testPlatformSms(ws, '酷狗音乐', '13800138000')
  await testPlatformSms(ws, 'QQ音乐', '13800138000')
  close(ws)
}

main().catch(e => { console.error(e); process.exit(1) })
