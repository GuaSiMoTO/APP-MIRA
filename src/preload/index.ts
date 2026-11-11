import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels, SendChannel, SendChannels } from '../shared/ipc'

// Los canales están tipados en src/shared/ipc.ts; aquí además se comprueba el prefijo en tiempo de ejecución
const allowed = /^(app|overlay|preview|editor|recorder|settings|player|ocr|pin|scroll|webcam|history|welcome):[a-z-]+$/

function check(channel: string): void {
  if (!allowed.test(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
}

const api = {
  invoke: <C extends InvokeChannel>(channel: C, ...args: InvokeChannels[C]['args']): Promise<InvokeChannels[C]['ret']> => {
    check(channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  send: <C extends SendChannel>(channel: C, ...args: SendChannels[C]): void => {
    check(channel)
    ipcRenderer.send(channel, ...args)
  },
  on: <C extends EventChannel>(channel: C, fn: (...args: EventChannels[C]) => void): (() => void) => {
    check(channel)
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => fn(...(args as EventChannels[C]))
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
