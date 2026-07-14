import { connect, close } from './scripts/lib/cdp-client.mjs'
import {
  openAccountModal,
  selectPlatform,
  selectMethod,
  fillPhone,
  clickSendCode,
  readModalError,
  readModalBody,
} from './scripts/lib/account-modal.mjs'

/**
 * 账号登录弹窗 SMS 测试示例（酷狗音乐、QQ音乐）。
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
