// Marco alrededor de una región y barra de controles junto a ella (grabación y captura con desplazamiento).
import { desktopCapturer, type BrowserWindow, type Display } from 'electron'
import type { Rect } from '../shared/types'
import { createWindow } from './windows'

const BORDER = 3

export function absRect(display: Display, rect: Rect): Rect {
  return { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height }
}

export function isFullScreen(display: Display, rect: Rect): boolean {
  return rect.width >= display.bounds.width - 1 && rect.height >= display.bounds.height - 1
}

/** Marco fino fuera de la región: no recibe el ratón y no sale en la captura. */
export function createRegionFrame(abs: Rect, color = '#ff4c60'): BrowserWindow {
  const frame = createWindow('border', {
    x: Math.round(abs.x - BORDER),
    y: Math.round(abs.y - BORDER),
    width: Math.round(abs.width + BORDER * 2),
    height: Math.round(abs.height + BORDER * 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    thickFrame: false
  })
  frame.setIgnoreMouseEvents(true)
  frame.setAlwaysOnTop(true, 'screen-saver')
  frame.setContentProtection(true)
  frame.webContents.once('did-finish-load', () => {
    void frame.webContents.executeJavaScript(`document.documentElement.style.setProperty('--frame', ${JSON.stringify(color)})`)
  })
  frame.once('ready-to-show', () => frame.showInactive())
  return frame
}

/** Posición de una barra: debajo de la región si cabe; si no, encima; si no, dentro abajo. */
export function barPosition(display: Display, abs: Rect, w: number, h: number): { x: number; y: number } {
  const wa = display.workArea
  let y = abs.y + abs.height + BORDER + 10
  if (y + h > wa.y + wa.height) y = abs.y - BORDER - 10 - h
  if (y < wa.y) y = wa.y + wa.height - h - 20
  let x = abs.x + abs.width / 2 - w / 2
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - w - 8)
  return { x: Math.round(x), y: Math.round(y) }
}

export function createControlBar(page: string, display: Display, abs: Rect, w: number, h: number): BrowserWindow {
  const pos = barPosition(display, abs, w, h)
  const bar = createWindow(page, {
    ...pos,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { backgroundThrottling: false }
  })
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.setContentProtection(true)
  bar.once('ready-to-show', () => bar.showInactive())
  return bar
}

export async function screenSourceId(display: Display): Promise<string | null> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  const s = sources.find((x) => x.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : null)
  return s?.id ?? null
}

/** Región en píxeles físicos (relativa a la pantalla), con ancho y alto pares. */
export function physicalCrop(display: Display, rect: Rect): Rect {
  const sf = display.scaleFactor
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
  return { x: Math.round(rect.x * sf), y: Math.round(rect.y * sf), width: even(rect.width * sf), height: even(rect.height * sf) }
}
