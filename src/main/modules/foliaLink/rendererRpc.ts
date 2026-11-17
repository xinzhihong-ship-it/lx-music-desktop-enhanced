// 主进程问主窗口（渲染进程）并等它回答：「Folia 对接」的搜索、歌单、歌词、封面、播放都在渲染进程里执行。
// 每个请求带一个 requestKey，渲染进程回答时带回来；超时或窗口没了就按失败结束。照 userApi 的请求队列写法。
// 不碰 electron（发送由 deps.send 注入），测试里直接驱动。
import { LinkError } from './ops'

export interface RendererRpcResponse {
  requestKey: string
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string }
}

export interface RendererRpcDeps {
  /** 把请求发给主窗口；窗口不在时回 false */
  send: (request: { requestKey: string, op: string, params: unknown }) => boolean
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** 普通请求的时限；搜索全部平台、读整张歌单可能更久，由调用方另给 */
export const DEFAULT_RPC_TIMEOUT_MS = 15_000

export const createRendererRpc = (deps: RendererRpcDeps) => {
  let seq = 0
  const pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: unknown }>()

  const settle = (requestKey: string) => {
    const entry = pending.get(requestKey)
    if (!entry) return null
    pending.delete(requestKey)
    deps.clearTimeout(entry.timer)
    return entry
  }

  const request = async<T = unknown>(op: string, params: unknown, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) => new Promise<T>((resolve, reject) => {
    const requestKey = `folia_link_${++seq}`
    const timer = deps.setTimeout(() => {
      if (settle(requestKey)) reject(new LinkError('timeout', `${op} timed out`))
    }, timeoutMs)
    pending.set(requestKey, { resolve: resolve as (value: unknown) => void, reject, timer })
    if (!deps.send({ requestKey, op, params })) {
      settle(requestKey)
      reject(new LinkError('unavailable', 'LX Music main window is not ready'))
    }
  })

  const handleResponse = (response: RendererRpcResponse) => {
    if (!response || typeof response.requestKey != 'string') return
    const entry = settle(response.requestKey)
    if (!entry) return
    if (response.ok) entry.resolve(response.data)
    else entry.reject(new LinkError(response.error?.code ?? 'failed', response.error?.message ?? 'Request failed'))
  }

  /** 窗口关了、对接关了：还在等的请求都按失败结束 */
  const cancelAll = (reason: string) => {
    for (const requestKey of [...pending.keys()]) settle(requestKey)?.reject(new LinkError('unavailable', reason))
  }

  return { request, handleResponse, cancelAll, pendingCount: () => pending.size }
}
