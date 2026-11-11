// Vista previa flotante (acceso rápido tras capturar): varias tarjetas apiladas, recuperar la
// última cerrada, información del archivo y posición/tamaño/cierre configurables.
import { BrowserWindow, dialog, nativeImage, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { statSync } from 'node:fs'
import { extname } from 'node:path'
import type { PreviewData } from '../shared/types'
import { openEditor } from './editor'
import { logError } from './log'
import { openPin } from './pin'
import { openPlayer } from './player'
import { copyImage, ensureSaveDir, saveImageToFolder, saveVideoAs } from './media'
import { getSettings } from './settings'
import { createWindow, ready, resourcePath } from './windows'
import { handle, on, sendTo } from './ipc'

const SIZES = { s: { w: 240, h: 204 }, m: { w: 300, h: 250 }, l: { w: 380, h: 312 } }
const MAX_CARDS = 4
const GAP = 4

interface Card {
  win: BrowserWindow
  data: PreviewData
}

let cards: Card[] = [] // [0] = la más reciente (abajo del todo)
let lastClosed: PreviewData | null = null

/** Archivos que usan las tarjetas abiertas y la última cerrada (no se pueden borrar). */
export function previewFiles(): string[] {
  return [...cards.map((c) => c.data.path), ...(lastClosed ? [lastClosed.path] : [])]
}

function size() {
  return SIZES[getSettings().previewSize] ?? SIZES.m
}

/** Coloca las tarjetas apiladas desde la esquina inferior (izquierda o derecha). */
function layout(): void {
  const { w, h } = size()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const right = getSettings().previewPosition === 'right'
  cards.forEach((c, i) => {
    if (c.win.isDestroyed()) return
    const x = right ? wa.x + wa.width - w - 16 : wa.x + 16
    const y = wa.y + wa.height - 16 - (i + 1) * h - i * GAP
    c.win.setBounds({ x, y, width: w, height: h })
  })
}

function fileInfo(d: PreviewData): string {
  try {
    const bytes = statSync(d.path).size
    const kb = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
    const fmt = extname(d.path).slice(1).toUpperCase()
    return [d.width ? `${d.width}×${d.height}` : '', fmt, kb].filter(Boolean).join(' · ')
  } catch {
    return ''
  }
}

export function showPreview(d: PreviewData): void {
  const s = getSettings()
  if (!s.previewEnabled) return
  // Como máximo 4 a la vez: la más antigua se va
  while (cards.length >= MAX_CARDS) closeCard(cards[cards.length - 1], false)
  const { w, h } = size()
  const win = createWindow('preview', {
    width: w,
    height: h,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true
  })
  win.setAlwaysOnTop(true, 'floating')
  // Que la miniatura no salga en las capturas siguientes
  win.setContentProtection(true)
  const card: Card = { win, data: d }
  cards.unshift(card)
  win.on('closed', () => {
    cards = cards.filter((c) => c !== card)
    layout()
  })
  layout()
  void ready(win).then(() => {
    if (win.isDestroyed()) return
    sendTo(win.webContents, 'preview:data', { ...d, info: fileInfo(d), autoClose: d.kind === 'image' ? s.previewAutoClose : 0 })
    win.showInactive()
  })
}

function closeCard(card: Card | undefined, remember = true): void {
  if (!card) return
  if (remember) lastClosed = card.data
  cards = cards.filter((c) => c !== card)
  if (!card.win.isDestroyed()) card.win.destroy()
  layout()
}

/** Cierra todas las vistas previas. */
export function closePreview(): void {
  for (const c of [...cards]) closeCard(c, false)
}

/** Vuelve a mostrar la última vista previa cerrada. */
export function restoreLastPreview(): boolean {
  if (!lastClosed) return false
  const d = lastClosed
  lastClosed = null
  showPreview(d)
  return true
}

export function hasClosedPreview(): boolean {
  return lastClosed !== null
}

const cardOf = (e: IpcMainEvent | IpcMainInvokeEvent) => cards.find((c) => !c.win.isDestroyed() && c.win.webContents === e.sender)

export function registerPreviewIpc(): void {
  on('preview:close', (e) => closeCard(cardOf(e)))
  on('preview:restore', () => restoreLastPreview())

  handle('preview:copy', async (e) => {
    const d = cardOf(e)?.data
    if (d?.kind !== 'image') return false
    await copyImage(nativeImage.createFromPath(d.path))
    return true
  })

  handle('preview:save', async (e) => {
    const card = cardOf(e)
    const d = card?.data
    if (!card || !d) return null
    if (d.kind === 'image') {
      const file = await saveImageToFolder(nativeImage.createFromPath(d.path))
      shell.showItemInFolder(file)
      return file
    }
    try {
      const file = await saveVideoAs(card.win, d.path)
      if (file) shell.showItemInFolder(file)
      return file
    } catch (err) {
      logError('No se pudo guardar el vídeo', err)
      dialog.showErrorBox('No se pudo guardar el vídeo', String(err instanceof Error ? err.message : err))
      return null
    }
  })

  on('preview:edit', (e) => {
    const card = cardOf(e)
    if (card?.data.kind !== 'image') return
    openEditor(card.data.path)
    closeCard(card)
  })

  on('preview:pin', (e) => {
    const card = cardOf(e)
    if (card?.data.kind !== 'image') return
    openPin(card.data.path, card.data.origin)
    closeCard(card)
  })

  on('preview:play', (e) => {
    const d = cardOf(e)?.data
    if (d?.kind === 'video') openPlayer(d)
  })

  // Doble clic en la miniatura: vídeo → editor de vídeo; imagen → editor
  on('preview:open', (e) => {
    const card = cardOf(e)
    if (!card) return
    if (card.data.kind === 'video') openPlayer(card.data)
    else {
      openEditor(card.data.path)
      closeCard(card)
    }
  })

  on('preview:drag', (e) => {
    const d = cardOf(e)?.data
    if (!d) return
    const icon =
      d.kind === 'image'
        ? nativeImage.createFromPath(d.path).resize({ width: 128 })
        : nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 64 })
    e.sender.startDrag({ file: d.path, icon })
  })

  on('preview:folder', () => {
    shell.openPath(ensureSaveDir())
  })

  handle('preview:settings', () => getSettings())
}
