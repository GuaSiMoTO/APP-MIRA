// IPC del proceso principal con los canales tipados de src/shared/ipc.ts.
// Los argumentos llegan como `unknown` (vienen de una ventana) y cada manejador los valida;
// el tipo de lo que se devuelve o se envía sí se comprueba contra el mapa de canales.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels, SendChannel } from '../shared/ipc'

type Ret<C extends InvokeChannel> = InvokeChannels[C]['ret']

export function handle<C extends InvokeChannel>(channel: C, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => Ret<C> | Promise<Ret<C>>): void {
  ipcMain.handle(channel, fn)
}

export function on<C extends SendChannel>(channel: C, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.on(channel, fn)
}

export function once<C extends SendChannel>(channel: C, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.once(channel, fn)
}

/** Envía un aviso a una ventana (si sigue abierta). */
export function sendTo<C extends EventChannel>(wc: WebContents | null | undefined, channel: C, ...args: EventChannels[C]): void {
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
}
