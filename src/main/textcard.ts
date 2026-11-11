// Tarjeta flotante con el texto reconocido por OCR (modo "Texto" y botón "Copiar texto" del editor).
import { BrowserWindow, clipboard, screen, shell, type NativeImage } from 'electron'
import jsQR from 'jsqr'
import { addTextToHistory } from './history'
import { ocrImage, ocrText } from './ocr'
import { createWindow, ready } from './windows'
import type { TextCardState } from '../shared/types'
import { handle, on, sendTo } from './ipc'

const WIDTH = 380
const HEIGHT = 290


let win: BrowserWindow | null = null

function ensureWindow(): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const bounds = { x: wa.x + 16, y: wa.y + wa.height - HEIGHT - 16, width: WIDTH, height: HEIGHT }
  if (win && !win.isDestroyed()) {
    win.setBounds(bounds)
    return win
  }
  win = createWindow('ocr', {
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setContentProtection(true)
  win.on('closed', () => (win = null))
  return win
}

function send(w: BrowserWindow, state: TextCardState): void {
  void ready(w).then(() => {
    if (w.isDestroyed()) return
    sendTo(w.webContents, 'ocr:state', state)
    if (!w.isVisible()) w.show()
  })
}

/** Lee un código QR de la imagen (si lo hay). */
export function readQr(img: NativeImage): string | null {
  try {
    const { width, height } = img.getSize()
    const bgra = img.toBitmap()
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = bgra[i + 2]
      rgba[i + 1] = bgra[i + 1]
      rgba[i + 2] = bgra[i]
      rgba[i + 3] = 255
    }
    return jsQR(rgba, width, height)?.data || null
  } catch {
    return null
  }
}

/** Reconoce el texto de la imagen, lo copia y lo muestra en la tarjeta. */
export async function recognizeAndShow(img: NativeImage): Promise<void> {
  const w = ensureWindow()
  send(w, { status: 'loading' })
  const qr = readQr(img)
  const res = await ocrImage(img)
  if (w.isDestroyed()) return
  if (!res.ok && !qr) {
    send(w, { status: 'error', error: res.error ?? 'No se pudo reconocer el texto.' })
    return
  }
  const text = res.ok ? ocrText(res) : ''
  // Si solo hay un QR, se copia su contenido; si hay texto, el texto (el QR tiene su propio botón)
  const copy = text || qr || ''
  if (copy) {
    await clipboard.writeText(copy)
    void addTextToHistory(copy, img)
  }
  send(w, { status: 'done', text, lang: res.lang, copied: !!copy, qr })
}

export function registerTextCardIpc(): void {
  handle('ocr:copy', async (_e, text: unknown) => {
    if (typeof text !== 'string') return false
    await clipboard.writeText(text)
    return true
  })
  on('ocr:open-url', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  on('ocr:close', () => {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  })
}
