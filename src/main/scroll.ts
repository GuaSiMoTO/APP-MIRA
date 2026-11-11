// Captura con desplazamiento: la barra de control graba fotogramas de la región, el proceso
// principal hace scroll con la rueda del ratón y el renderer une las partes.
import { BrowserWindow, dialog, screen, type Display, type NativeImage } from 'electron'
import type { Rect, ScrollInit } from '../shared/types'
import { finishImage } from './output'
import { absRect, createControlBar, createRegionFrame, physicalCrop, screenSourceId } from './regionui'
import { sendWheel, setCursorPos } from './winapi'
import { isNum } from './validate'
import { logError } from './log'
import { imageFromBytes } from './files'
import { handle, on, sendTo } from './ipc'

let bar: BrowserWindow | null = null
let frame: BrowserWindow | null = null
let init: ScrollInit | null = null
let center: { x: number; y: number } | null = null
let savedCursor: { x: number; y: number } | null = null
let origin: Rect | undefined
// Mientras se busca la pantalla todavía no hay barra, pero la captura ya está en marcha
let starting = false

export function isScrolling(): boolean {
  return bar !== null || starting
}

export function stopScrolling(): void {
  if (bar) sendTo(bar.webContents, 'scroll:stop')
  else starting = false // cancela el arranque
}

function cleanup(): void {
  // Se sueltan antes de destruirlas: así los avisos que lleguen al cerrarlas ya no las reconocen
  const wins = [bar, frame]
  bar = frame = null
  init = null
  for (const w of wins) if (w && !w.isDestroyed()) w.destroy()
  // Devolver el cursor a donde estaba
  if (savedCursor) {
    const p = screen.dipToScreenPoint(savedCursor)
    setCursorPos(p.x, p.y)
    savedCursor = null
  }
}

export async function startScrollCapture(display: Display, rect: Rect): Promise<void> {
  if (bar || starting) return
  starting = true
  let sourceId: string | null
  try {
    sourceId = await screenSourceId(display)
  } catch (err) {
    logError('Captura con desplazamiento: no se pudo obtener la pantalla', err)
    sourceId = null
  }
  if (!starting) return // se canceló mientras tanto
  starting = false
  if (!sourceId) {
    dialog.showErrorBox('No se puede capturar', 'No se encontró la pantalla seleccionada.')
    return
  }
  const sf = display.scaleFactor
  init = {
    sourceId,
    screenWidth: Math.round(display.bounds.width * sf),
    screenHeight: Math.round(display.bounds.height * sf),
    crop: physicalCrop(display, rect)
  }
  const abs = absRect(display, rect)
  origin = abs
  center = { x: abs.x + abs.width / 2, y: abs.y + abs.height / 2 }
  savedCursor = screen.getCursorScreenPoint()
  frame = createRegionFrame(abs, '#5b7cfa')
  const b = createControlBar('scroll', display, abs, 430, 56)
  bar = b
  b.on('closed', () => {
    if (bar === b) cleanup()
  })
  b.webContents.on('render-process-gone', (_e, details) => {
    if (bar !== b) return
    cleanup()
    logError('La captura con desplazamiento se ha interrumpido', details.reason)
    dialog.showErrorBox('Error en la captura con desplazamiento', 'La captura se ha interrumpido inesperadamente.')
  })
}

export function registerScrollIpc(): void {
  handle('scroll:init', () => init)

  // Una "muesca" de rueda = 120. El cursor se coloca en el centro de la región para que
  // el desplazamiento llegue a la ventana que está debajo.
  handle('scroll:wheel', async (_e, notches: unknown) => {
    if (!center || !isNum(notches) || !Number.isInteger(notches) || Math.abs(notches) > 10) return false
    const p = screen.dipToScreenPoint(center)
    setCursorPos(p.x, p.y)
    sendWheel(-120 * notches)
    // Se aparta el cursor de la región para que no salga en la captura
    await new Promise((r) => setTimeout(r, 40))
    if (bar && !bar.isDestroyed()) {
      const b = bar.getBounds()
      const park = screen.dipToScreenPoint({ x: b.x + 40, y: b.y + b.height / 2 })
      setCursorPos(park.x, park.y)
    }
    return true
  })

  handle('scroll:done', async (_e, png: unknown) => {
    const o = origin
    cleanup()
    let img: NativeImage
    try {
      img = imageFromBytes(png)
    } catch (err) {
      logError('Captura con desplazamiento: imagen no válida', err)
      return
    }
    await finishImage(img, o)
  })

  on('scroll:cancel', () => cleanup())

  on('scroll:error', (_e, message: unknown) => {
    cleanup()
    const text = typeof message === 'string' ? message.slice(0, 500) : 'Error desconocido'
    logError('Error en la captura con desplazamiento', text)
    dialog.showErrorBox('Error en la captura con desplazamiento', text)
  })
}
