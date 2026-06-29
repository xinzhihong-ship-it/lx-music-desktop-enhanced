import { Worker } from 'node:worker_threads'
import path from 'node:path'
import * as Comlink from 'comlink'
import nodeEndpoint from 'comlink/dist/esm/node-adapter'

export type DBSeriveTypes = Comlink.Remote<LX.WorkerDBSeriveListTypes>

export const createDBServiceWorker = () => {
  const worker: Worker = new Worker(path.join(__dirname, 'dbService.worker.js'))
  return Comlink.wrap<LX.WorkerDBSeriveListTypes>(nodeEndpoint(worker))
}

