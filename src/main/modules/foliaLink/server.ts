// 「Folia 对接」的 HTTP 服务：只监听 127.0.0.1 的随机端口，每个请求都要带连接文件里的令牌（Bearer）。
//   GET  /status   现在的播放状态（Folia 播放时每 500 ms 问一次）
//   POST /rpc      { op, params } → { ok: true, data } 或 { ok: false, error: { code, message } }
//   GET  /events   SSE：状态有了要马上知道的变化（换歌、暂停、拖动、音量…）、列表变了，就推一条
// 浏览器发来的请求（带 Origin）和 Host 不是本机回环地址的请求一律拒绝：网页不能借用户的浏览器来控制落雪。
// 不碰 electron，测试里直接起服务。
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { LinkError } from './ops'

export interface LinkServerDeps {
  token: string
  getState: () => unknown
  handleRpc: (op: unknown, params: unknown) => Promise<unknown>
  log: (level: 'info' | 'warn', message: string, detail?: unknown) => void
  now: () => number
}

/** 请求体上限：加入歌单一次最多 1000 首，每首几百字节 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024
/** SSE 心跳：中间没有事件时也让连接保持活着，Folia 据此判断落雪还在 */
export const HEARTBEAT_MS = 15_000
/** 多久内有过请求算「Folia 连着」 */
export const CLIENT_ACTIVE_MS = 10_000

const STATUS_BY_CODE: Record<string, number> = {
  'invalid-params': 400,
  'unknown-op': 404,
  'unknown-source': 400,
  unavailable: 503,
  timeout: 504,
}

const tokenMatches = (header: string | undefined, token: string) => {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  if (!match) return false
  const given = Buffer.from(match[1], 'utf-8')
  const expected = Buffer.from(token, 'utf-8')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  const data = Buffer.from(JSON.stringify(body), 'utf-8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

const readBody = async(req: http.IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      reject(new LinkError('invalid-params', 'Request body is too large'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')) })
  req.on('error', reject)
})

export const createLinkServer = (deps: LinkServerDeps) => {
  let server: http.Server | null = null
  let port = 0
  let lastClientAt = 0
  const streams = new Set<http.ServerResponse>()
  let heartbeat: NodeJS.Timeout | null = null

  const writeEvent = (res: http.ServerResponse, event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** 推一条事件给所有连着的 Folia */
  const broadcast = (event: string, data: unknown) => {
    for (const res of streams) writeEvent(res, event, data)
  }

  const isLoopbackHost = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`

  const handle = async(req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.headers.origin !== undefined || !isLoopbackHost(req.headers.host)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Forbidden' } })
      return
    }
    if (!tokenMatches(req.headers.authorization, deps.token)) {
      sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'Unauthorized' } })
      return
    }
    lastClientAt = deps.now()
    const pathname = (req.url ?? '').split('?')[0]
    if (req.method == 'GET' && pathname == '/status') {
      sendJson(res, 200, { ok: true, data: deps.getState() })
      return
    }
    if (req.method == 'GET' && pathname == '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      req.socket.setTimeout(0)
      streams.add(res)
      req.on('close', () => { streams.delete(res) })
      writeEvent(res, 'state', deps.getState())
      return
    }
    if (req.method == 'POST' && pathname == '/rpc') {
      let body: any
      try {
        body = JSON.parse(await readBody(req))
      } catch (err) {
        const code = err instanceof LinkError ? err.code : 'invalid-params'
        sendJson(res, 400, { ok: false, error: { code, message: 'Request body must be JSON' } })
        return
      }
      try {
        const data = await deps.handleRpc(body?.op, body?.params)
        sendJson(res, 200, { ok: true, data: data ?? null })
      } catch (err: any) {
        const code = err instanceof LinkError ? err.code : 'failed'
        if (!(err instanceof LinkError)) deps.log('warn', `[FoliaLink] ${String(body?.op)} failed`, err)
        sendJson(res, STATUS_BY_CODE[code] ?? 500, { ok: false, error: { code, message: String(err?.message ?? err) } })
      }
      return
    }
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'Not found' } })
  }

  const start = async() => new Promise<number>((resolve, reject) => {
    const instance = http.createServer((req, res) => {
      handle(req, res).catch(err => {
        deps.log('warn', '[FoliaLink] request failed', err)
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'failed', message: 'Internal error' } })
        else res.end()
      })
    })
    instance.on('error', reject)
    instance.listen(0, '127.0.0.1', () => {
      server = instance
      port = (instance.address() as AddressInfo).port
      heartbeat = setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, HEARTBEAT_MS)
      resolve(port)
    })
  })

  const stop = async() => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    for (const res of streams) res.end()
    streams.clear()
    const instance = server
    server = null
    port = 0
    if (!instance) return
    await new Promise<void>(resolve => {
      instance.close(() => { resolve() })
      instance.closeAllConnections?.()
    })
  }

  /** Folia 最近有没有来过（连着事件流或者刚问过） */
  const isClientActive = () => streams.size > 0 || (lastClientAt > 0 && deps.now() - lastClientAt < CLIENT_ACTIVE_MS)

  return { start, stop, broadcast, isClientActive, getPort: () => port }
}
