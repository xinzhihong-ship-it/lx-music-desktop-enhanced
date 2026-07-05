import { ipcRenderer } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const rendererLogPath = path.join(os.homedir(), 'Library', 'Logs', 'lx-music-desktop', 'renderer.log')
export const writeRendererLog = (...args: any[]) => {
  try {
    const line = args.map(a => {
      if (a == null) return String(a)
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a, Object.getOwnPropertyNames(a))
        } catch {
          return String(a)
        }
      }
      return String(a)
    }).join(' ') + '\n'
    fs.appendFileSync(rendererLogPath, `${new Date().toISOString()} ${line}`)
  } catch {}
}

export function rendererSend(name: string): void
export function rendererSend<T>(name: string, params: T): void
export function rendererSend<T>(name: string, params?: T): void {
  ipcRenderer.send(name, params)
}

export function rendererSendSync(name: string): void
export function rendererSendSync<T>(name: string, params: T): void
export function rendererSendSync<T>(name: string, params?: T): void {
  ipcRenderer.sendSync(name, params)
}

export async function rendererInvoke(name: string): Promise<void>
export async function rendererInvoke<V>(name: string): Promise<V>
export async function rendererInvoke<T>(name: string, params: T): Promise<void>
export async function rendererInvoke<T, V>(name: string, params: T): Promise<V>
export async function rendererInvoke <T, V>(name: string, params?: T): Promise<V> {
  writeRendererLog('[rendererInvoke] call:', name, 'params type:', typeof params)
  try {
    const result = await ipcRenderer.invoke(name, params)
    writeRendererLog('[rendererInvoke] success:', name, 'result type:', typeof result, 'result:', result)
    return result
  } catch (err: any) {
    writeRendererLog('[rendererInvoke] error:', name, 'err type:', typeof err, 'err:', err)
    console.error(`[rendererInvoke] ${name} error:`, err)
    if (err instanceof Error) throw err
    let message = err?.message
    if (message == null) message = typeof err === 'string' ? err : String(err)
    throw new Error(message || '未知错误')
  }
}

export function rendererOn(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  ipcRenderer.on(name, (event, params) => {
    listener({ event, params })
  })
}

export function rendererOnce(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  ipcRenderer.once(name, (event, params) => {
    listener({ event, params })
  })
}

export const rendererOff = (name: string, listener: (...args: any[]) => any) => {
  ipcRenderer.removeListener(name, listener)
}

export const rendererOffAll = (name: string) => {
  ipcRenderer.removeAllListeners(name)
}
