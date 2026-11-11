import type { Api } from '../../preload'
import type { EventChannel, EventChannels } from '../../shared/ipc'

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api

// ---------- Errores ----------

const MAX_REPORTS = 20 // por ventana: un error en bucle no debe llenar el registro
let reports = 0

/** Envía un error al proceso principal para que quede en mira.log. */
export function reportError(context: string, err: unknown): void {
  console.error(context, err)
  if (reports++ >= MAX_REPORTS) return
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  try {
    api.send('app:error', `${context}: ${detail}`.slice(0, 4000))
  } catch {
    /* sin IPC solo queda la consola */
  }
}

// Lo que se escape de cualquier manejador también se registra
window.addEventListener('error', (e) => reportError('Error no capturado', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportError('Promesa rechazada sin manejar', e.reason))

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`No existe ${sel}`)
  return el
}

/** Espera el primer aviso de un canal y devuelve su dato. */
export function waitFor<C extends EventChannel>(channel: C): Promise<EventChannels[C][0]> {
  return new Promise((resolve) => {
    const off = api.on(channel, (...args) => {
      off()
      resolve(args[0])
    })
  })
}
