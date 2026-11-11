// Capturas ancladas: ventanas sin marco, siempre encima, que se pueden mover, escalar y hacer translúcidas.
import { BrowserWindow, Menu, nativeImage, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import type { Rect } from '../shared/types'
import { openEditor } from './editor'
import { logError } from './log'
import { copyImage, saveImageAs, saveImageToFolder } from './media'
import { clamp, isNum } from './validate'
import { createWindow } from './windows'
import { handle, on } from './ipc'

interface Pin {
  path: string
  aspect: number
  baseWidth: number // ancho a escala 100 % (DIP)
}
const pins = new Map<number, Pin>()

/** Archivos de las capturas ancladas abiertas (no se pueden borrar). */
export function pinFiles(): string[] {
  return [...pins.values()].map((p) => p.path)
}

export function openPin(path: string, origin?: Rect): void {
  const img = nativeImage.createFromPath(path)
  const size = img.getSize()
  if (!size.width) return
  const cursor = screen.getCursorScreenPoint()
  const display = origin ? screen.getDisplayMatching(origin) : screen.getDisplayNearestPoint(cursor)
  const wa = display.workArea
  // Tamaño real en DIP, sin pasar del 70 % del área de trabajo
  let width = size.width / display.scaleFactor
  let height = size.height / display.scaleFactor
  const fitScale = Math.min(1, (wa.width * 0.7) / width, (wa.height * 0.7) / height)
  width = Math.round(width * fitScale)
  height = Math.round(height * fitScale)
  const x = origin ? Math.round(origin.x) : Math.round(wa.x + (wa.width - width) / 2)
  const y = origin ? Math.round(origin.y) : Math.round(wa.y + (wa.height - height) / 2)

  const win = createWindow('pin', {
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    title: 'Captura anclada',
    backgroundColor: '#00000000'
  })
  win.setAlwaysOnTop(true, 'floating')
  const id = win.webContents.id
  pins.set(id, { path, aspect: size.width / size.height, baseWidth: size.width / display.scaleFactor })
  win.on('closed', () => pins.delete(id))
  win.once('ready-to-show', () => win.showInactive())
}

function pinFor(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(e.sender)
  const pin = pins.get(e.sender.id)
  return win && pin ? { win, pin } : null
}

function setScale(win: BrowserWindow, pin: Pin, width: number, anchor?: { x: number; y: number }): void {
  const b = win.getBounds()
  const w = Math.round(Math.min(Math.max(width, 80), pin.baseWidth * 4))
  const h = Math.round(w / pin.aspect)
  // Mantener fijo el punto bajo el cursor (o el centro)
  const ax = anchor?.x ?? b.x + b.width / 2
  const ay = anchor?.y ?? b.y + b.height / 2
  const fx = (ax - b.x) / b.width
  const fy = (ay - b.y) / b.height
  win.setBounds({ x: Math.round(ax - fx * w), y: Math.round(ay - fy * h), width: w, height: h })
}

export function registerPinIpc(): void {
  handle('pin:get', async (e) => {
    const p = pins.get(e.sender.id)
    if (!p) return null
    try {
      return await readFile(p.path)
    } catch (err) {
      logError('Captura anclada: no se pudo leer la imagen', err)
      return null
    }
  })

  on('pin:move', (e, dx: unknown, dy: unknown) => {
    const p = pinFor(e)
    if (!p || !isNum(dx) || !isNum(dy)) return
    const [x, y] = p.win.getPosition()
    p.win.setPosition(Math.round(x + dx), Math.round(y + dy))
  })

  on('pin:zoom', (e, factor: unknown) => {
    const p = pinFor(e)
    if (!p || !isNum(factor)) return
    setScale(p.win, p.pin, p.win.getBounds().width * clamp(factor, 0.1, 10), screen.getCursorScreenPoint())
  })

  on('pin:reset', (e) => {
    const p = pinFor(e)
    if (p) setScale(p.win, p.pin, p.pin.baseWidth)
  })

  handle('pin:opacity', (e, delta: unknown) => {
    const p = pinFor(e)
    if (!p) return 1
    if (!isNum(delta)) return p.win.getOpacity()
    const o = Math.min(1, Math.max(0.2, p.win.getOpacity() + delta))
    p.win.setOpacity(o)
    return o
  })

  on('pin:close', (e) => pinFor(e)?.win.close())

  on('pin:edit', (e) => {
    const p = pinFor(e)
    if (!p) return
    openEditor(p.pin.path)
    p.win.close()
  })

  handle('pin:copy', async (e) => {
    const p = pinFor(e)
    if (p) await copyImage(nativeImage.createFromPath(p.pin.path))
    return true
  })

  on('pin:menu', (e) => {
    const p = pinFor(e)
    if (!p) return
    const { win, pin } = p
    const opacity = (v: number) => () => win.setOpacity(v)
    Menu.buildFromTemplate([
      { label: 'Copiar', click: () => void copyImage(nativeImage.createFromPath(pin.path)) },
      { label: 'Guardar en la carpeta', click: () => void saveImageToFolder(nativeImage.createFromPath(pin.path)) },
      {
        label: 'Guardar como…',
        click: () => void saveImageAs(win, nativeImage.createFromPath(pin.path))
      },
      { label: 'Editar', click: () => { openEditor(pin.path); win.close() } },
      { type: 'separator' },
      { label: 'Tamaño real', click: () => setScale(win, pin, pin.baseWidth) },
      {
        label: 'Opacidad',
        submenu: [
          { label: '100 %', click: opacity(1) },
          { label: '75 %', click: opacity(0.75) },
          { label: '50 %', click: opacity(0.5) },
          { label: '25 %', click: opacity(0.25) }
        ]
      },
      { type: 'separator' },
      { label: 'Cerrar', click: () => win.close() },
      { label: 'Cerrar todas las ancladas', click: () => closeAllPins() }
    ]).popup({ window: win })
  })
}

export function closeAllPins(): void {
  for (const w of BrowserWindow.getAllWindows()) if (pins.has(w.webContents.id)) w.close()
}

export function hasPins(): boolean {
  return pins.size > 0
}
