// Editor de vídeo: reproductor con recorte (inicio/fin) y exportación con calidad.
import { BrowserWindow, dialog, screen, shell } from 'electron'
import { basename, join } from 'node:path'
import type { PreviewData } from '../shared/types'
import { logError } from './log'
import { exportVideo, ffmpegPath, type ExportOptions } from './ffmpeg'
import { askSavePath, ensureSaveDir, freeName, recordingName, VIDEO_FILTERS } from './files'
import { isNum, isObj, oneOf } from './validate'
import { createWindow } from './windows'
import { handle, on, sendTo } from './ipc'

const videos = new Map<number, PreviewData>()

/** Vídeos abiertos en el reproductor (no se pueden borrar). */
export function playerFiles(): string[] {
  return [...videos.values()].map((d) => d.path)
}

/** Abre la grabación en una ventana propia, sin marco y con una X para cerrarla. */
export function openPlayer(data: PreviewData): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const width = Math.round(Math.min(1280, Math.max(860, wa.width * 0.7)))
  const height = Math.round(Math.min(900, Math.max(620, wa.height * 0.78)))
  const win = createWindow('player', {
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 760,
    minHeight: 540,
    frame: false,
    title: basename(data.path),
    backgroundColor: '#0e0e10'
  })
  const id = win.webContents.id
  videos.set(id, data)
  win.on('closed', () => videos.delete(id))
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
}

const isFormat = oneOf(['mp4', 'gif', 'webm'] as const)
const isQuality = oneOf(['high', 'medium', 'low'] as const)
const optPositive = (v: unknown) => v === null || (isNum(v) && v > 0 && v <= 10000)

/** Opciones de exportación enviadas por el editor de vídeo; null si no son válidas. */
function exportOptions(v: unknown): ExportOptions | null {
  if (!isObj(v) || !isFormat(v.format) || !isQuality(v.quality)) return null
  if (!isNum(v.start) || !isNum(v.end)) return null
  const start = Math.max(0, v.start)
  if (v.end <= start) return null
  if (!optPositive(v.height) || !optPositive(v.fps)) return null
  return { format: v.format, quality: v.quality, start, end: v.end, height: v.height as number | null, fps: v.fps as number | null }
}

export function registerPlayerIpc(): void {
  handle('player:get', (e) => {
    const d = videos.get(e.sender.id)
    return d ? { src: d.src, name: basename(d.path), ffmpeg: !!ffmpegPath() } : null
  })
  on('player:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  on('player:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  handle('player:export', async (e, raw: unknown) => {
    const d = videos.get(e.sender.id)
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = exportOptions(raw)
    if (!d || !win || !opts) return null
    const dir = ensureSaveDir()
    const file = await askSavePath(win, {
      title: 'Exportar grabación',
      defaultPath: join(dir, freeName(dir, recordingName(opts.format))),
      filters: [VIDEO_FILTERS[opts.format]]
    })
    if (!file) return null
    try {
      await exportVideo(d.path, file, opts, (p) => {
        if (!e.sender.isDestroyed()) sendTo(e.sender, 'player:progress', p)
      })
      shell.showItemInFolder(file)
      return file
    } catch (err) {
      logError('No se pudo exportar el vídeo', err)
      dialog.showErrorBox('No se pudo exportar el vídeo', String(err instanceof Error ? err.message : err))
      return null
    }
  })
}
