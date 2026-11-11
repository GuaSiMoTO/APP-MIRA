// Lectura y escritura seguras de los JSON de la app (ajustes e historial).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { logError } from './log'

/**
 * Lee un JSON. Devuelve undefined si no existe. Si está dañado, lo aparta como copia
 * `.corrupt-<fecha>.bak` (para poder recuperarlo a mano) en lugar de perderlo.
 */
export function readJson(file: string): unknown {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
    logError(`Archivo dañado, se guarda una copia en ${backup}`, err)
    try {
      renameSync(file, backup)
    } catch (e) {
      logError(`No se pudo apartar ${file}`, e)
    }
    return undefined
  }
}

/** Escribe un JSON de forma atómica: un corte a mitad nunca deja el archivo original a medias. */
export function writeJsonAtomic(file: string, data: unknown, indent = 2): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, indent))
  renameSync(tmp, file)
}
