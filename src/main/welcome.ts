// Aviso de inicio propio (sustituye a la notificación de Windows, que muestra "Electron" en la
// cabecera): logo + "MIRA" y, debajo, solo el atajo de teclado. Se cierra solo.
import { BrowserWindow, nativeImage, screen } from 'electron'
import { createWindow, ready, resourcePath } from './windows'
import { on, sendTo } from './ipc'

const W = 320
const H = 150

let win: BrowserWindow | null = null
let onClick: () => void = () => {}

/** Muestra el aviso abajo a la derecha de la pantalla principal. `hotkey` ya formateado ("Ctrl + Mayús + S"). */
export function showWelcome(hotkey: string, click: () => void): void {
  onClick = click
  const wa = screen.getPrimaryDisplay().workArea
  if (win && !win.isDestroyed()) win.destroy()
  win = createWindow('welcome', {
    x: wa.x + wa.width - W - 16,
    y: wa.y + wa.height - H - 16,
    width: W,
    height: H,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    title: 'Mira'
  })
  win.setAlwaysOnTop(true, 'floating')
  const w = win
  void ready(w).then(() => {
    if (w.isDestroyed()) return
    const icon = nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 128, quality: 'best' }).toDataURL()
    // Letras del logo con su color original
    const word = nativeImage.createFromPath(resourcePath('brand', 'mira-wordmark.png'))
    const wordmark = word.isEmpty() ? '' : word.resize({ height: 60, quality: 'best' }).toDataURL()
    sendTo(w.webContents, 'welcome:data', { icon, wordmark, hotkey })
    w.showInactive()
  })
  w.on('closed', () => {
    if (win === w) win = null
  })
}

export function registerWelcomeIpc(): void {
  on('welcome:click', () => {
    if (win && !win.isDestroyed()) win.destroy()
    onClick()
  })
  on('welcome:close', () => {
    if (win && !win.isDestroyed()) win.destroy()
  })
}
