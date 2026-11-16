// Folia Stage API 的 HTTP 请求：只发往连接文件给出的本机回环端口，带 bearer token，JSON 进出。
// 不走系统代理（直接用 node:http 连 127.0.0.1）。
import http from 'node:http'
import type { StageRequest } from './bridge'

export const REQUEST_TIMEOUT_MS = 4000

export const requestStage: StageRequest = async(connection, method, pathname, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8')
  const req = http.request({
    host: '127.0.0.1',
    port: connection.port,
    path: pathname,
    method,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(data ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length } : {}),
    },
  }, res => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
      } catch {}
      resolve({ status: res.statusCode ?? 0, body: parsed })
    })
    res.on('error', reject)
  })
  req.on('timeout', () => req.destroy(new Error('Folia Stage API request timed out')))
  req.on('error', reject)
  if (data) req.write(data)
  req.end()
})
