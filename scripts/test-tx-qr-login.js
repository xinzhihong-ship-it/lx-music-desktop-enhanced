// QQ Music App QR login regression check.
// Run: node scripts/test-tx-qr-login.js
// Add --wait to keep listening for a manual QQ Music App scan.

const fs = require('node:fs')
const path = require('node:path')
const mqtt = require('mqtt')

const endpoint = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const tmeAppID = 'qqmusic'
const waitForScan = process.argv.includes('--wait')

const assertProviderProtocol = () => {
  const provider = fs.readFileSync(path.join(__dirname, '../src/main/modules/account/providers/tx.ts'), 'utf8')
  const required = ['music.login.LoginServer', 'CreateQRCode', 'management.qrcode_login/']
  if (required.some(value => !provider.includes(value)) || provider.includes('ssl.ptlogin2.qq.com')) {
    throw new Error('QQ provider is not using the QQ Music App QR protocol')
  }
}

const createQrCode = async() => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' },
    body: JSON.stringify({
      comm: {},
      req_0: {
        module: 'music.login.LoginServer',
        method: 'CreateQRCode',
        param: { tmeAppID, ct: 19, cv: 11060000 },
      },
    }),
  })
  const body = await response.json()
  const result = body.req_0
  if (!response.ok || body.code !== 0 || result?.code !== 0) throw new Error('CreateQRCode request failed')
  const data = result.data ?? {}
  if (!data.qrcodeID || !String(data.qrcode).startsWith('data:image/png;base64,')) {
    throw new Error('CreateQRCode returned an invalid QQ Music QR image')
  }
  return data
}

const connectQrStatus = (qrcodeID, serverReference = '', redirectCount = 0) => new Promise((resolve, reject) => {
  const pathName = `/ws/handshake${serverReference ? `/${serverReference}` : ''}`
  const client = mqtt.connect(`wss://mu.y.qq.com${pathName}`, {
    protocolVersion: 5,
    clean: true,
    keepalive: 45,
    reconnectPeriod: 0,
    connectTimeout: 15000,
    clientId: `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`,
    properties: {
      authenticationMethod: 'pass',
      userProperties: {
        tmeAppID,
        business: 'management',
        hashTag: qrcodeID,
        clientTag: 'management.user',
        userID: qrcodeID,
      },
    },
  })
  let settled = false
  let redirect = ''
  const timer = setTimeout(() => {
    client.end(true)
    reject(new Error('MQTT connection timed out'))
  }, 20000)

  client.on('packetreceive', packet => {
    if (packet.cmd === 'connack') redirect = packet.properties?.serverReference ?? ''
  })
  client.once('connect', () => {
    client.subscribe(`management.qrcode_login/${qrcodeID}`, {
      qos: 0,
      properties: { userProperties: { authorization: 'tmelogin', pubsub: 'unicast' } },
    }, err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(client)
    })
  })
  client.on('error', err => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    client.end(true)
    if ((err.code === 156 || err.code === 157) && redirect && redirectCount < 3) {
      connectQrStatus(qrcodeID, redirect, redirectCount + 1).then(resolve, reject)
    } else {
      reject(err)
    }
  })
})

const main = async() => {
  assertProviderProtocol()
  const qr = await createQrCode()
  const client = await connectQrStatus(qr.qrcodeID)
  console.log(`PASS: QQ Music App QR created and MQTT subscribed (expires in ${qr.expiresIn}s)`)
  if (!waitForScan) {
    client.end(true)
    return
  }
  console.log('Open the app login dialog and scan its QR code with QQ Music App.')
  client.on('message', (_topic, message, packet) => {
    const type = packet.properties?.userProperties?.type ?? 'unknown'
    let cookieCount = 0
    try {
      cookieCount = Object.keys(JSON.parse(message.toString('utf8')).cookies ?? {}).length
    } catch {}
    console.log(`event=${type}${type === 'cookies' ? ` cookieCount=${cookieCount}` : ''}`)
    if (['cookies', 'timeout', 'canceled', 'loginFailed'].includes(type)) client.end(true)
  })
}

main().catch(err => {
  console.error(`FAIL: ${err.message}`)
  process.exitCode = 1
})
