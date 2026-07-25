export const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error('operation aborted')
}

export const createRequestSignal = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  const abort = () => { controller.abort() }
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }
  const timeout = setTimeout(abort, timeoutMs)
  timeout.unref?.()

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    },
  }
}
