// Registro de errores en userData/mira.log para poder diagnosticar fallos de los usuarios.
import { app } from 'electron'
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1024 * 1024

export function logError(context: string, err?: unknown): void {
  console.error(context, err ?? '')
  try {
    const file = join(app.getPath('userData'), 'mira.log')
    // Se conserva solo el registro anterior para que no crezca sin límite
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(app.getPath('userData'), 'mira.old.log'))
    const detail = err instanceof Error ? (err.stack ?? err.message) : err === undefined ? '' : String(err)
    appendFileSync(file, `[${new Date().toISOString()}] ${context}${detail ? `: ${detail}` : ''}\n`)
  } catch {
    /* si no se puede escribir el registro, basta con la consola */
  }
}
