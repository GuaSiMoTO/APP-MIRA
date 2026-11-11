// Instancia única. En desarrollo (npm run dev) la Mira instalada usa la misma carpeta de datos y
// el mismo bloqueo: si está abierta, se le pide que se cierre (o se termina su proceso) para
// dejar paso a la versión de desarrollo, y se avisa.
import { app, Notification } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { logError } from './log'
import { isObj } from './validate'

const TAKEOVER = { devTakeover: true }
const INSTALLED_EXE = 'Mira.exe'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Pide el bloqueo de instancia única. En desarrollo, la petición lleva el aviso para la instalada. */
export function requestLock(): boolean {
  return app.isPackaged ? app.requestSingleInstanceLock() : app.requestSingleInstanceLock(TAKEOVER)
}

/** ¿Esta es la Mira instalada y la otra instancia es la versión de desarrollo pidiendo paso? */
export function isTakeoverRequest(data: unknown): boolean {
  return app.isPackaged && isObj(data) && data.devTakeover === true
}

/**
 * ¿Puede ser la Mira instalada quien tiene el bloqueo? Solo si comparte la carpeta de datos (sin
 * --user-data-dir, como en las pruebas de humo) y está abierta. Si no, quien tiene el bloqueo es
 * otra copia de desarrollo y no se debe cerrar nada.
 */
export function installedRunning(): boolean {
  if (app.commandLine.hasSwitch('user-data-dir')) return false
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${INSTALLED_EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true, encoding: 'utf8' })
    return out.toLowerCase().includes(`"${INSTALLED_EXE.toLowerCase()}"`)
  } catch (err) {
    logError('No se pudo comprobar si la Mira instalada está abierta', err)
    return false
  }
}

/**
 * Solo en desarrollo, cuando otra Mira tiene el bloqueo. La instalada (desde esta versión) se cierra
 * sola al recibir la petición; las versiones instaladas anteriores no saben hacerlo, así que se
 * termina su proceso. Devuelve true si esta instancia ya tiene el bloqueo.
 */
export async function takeOverInstalled(): Promise<boolean> {
  await sleep(1500)
  if (app.requestSingleInstanceLock(TAKEOVER)) return true
  await new Promise<void>((resolve) =>
    execFile('taskkill', ['/F', '/IM', INSTALLED_EXE], { windowsHide: true }, (err) => {
      if (err) logError('No se pudo cerrar la Mira instalada', err)
      resolve()
    })
  )
  for (let i = 0; i < 20; i++) {
    await sleep(250)
    if (app.requestSingleInstanceLock(TAKEOVER)) return true
  }
  return false
}

/** Aviso en desarrollo de que se ha cerrado la Mira instalada. */
export function notifyTakeover(): void {
  const body = 'Se ha cerrado la Mira instalada para usar la versión de desarrollo (npm run dev).'
  console.log(`\n[Mira] ${body}\n`)
  if (Notification.isSupported()) new Notification({ title: 'Mira · desarrollo', body, silent: true }).show()
}
