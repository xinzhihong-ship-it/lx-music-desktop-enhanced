export interface HttpFetchResult {
  isCancelled: boolean
  cancelHttp: () => true | undefined
  promise: Promise<any>
}

export const httpFetch: (url: string, options?: Record<string, any>) => HttpFetchResult
export const cancelHttp: (requestObj: any) => void
