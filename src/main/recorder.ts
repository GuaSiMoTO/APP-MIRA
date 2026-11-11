import { BrowserWindow, dialog, Notification, screen, type Display } from 'electron'
import { open, stat, unlink, type FileHandle } from 'node:fs/promises'
import type { OverlayState, Rect, RecorderInit } from '../shared/types'
import { addVideoToHistory } from './history'
import { startInputHook, stopInputHook } from './inputhook'
import { fixWebm, mediaUrl, recordingName, tempDir, writeNewFile } from './media'
import { showPreview } from './preview'
import { absRect, createControlBar, createRegionFrame, isFullScreen, physicalCrop, screenSourceId } from './regionui'
import { logError } from './log'
import { toBuffer } from './validate'
import { createWindow } from './windows'
import { handle, on, once, sendTo } from './ipc'

const BAR_W = 300
const BAR_H = 56
const CAM_SIZES = { s: 150, m: 210, l: 290 }

let bar: BrowserWindow | null = null
let frame: BrowserWindow | null = null
let cam: BrowserWindow | null = null
let init: RecorderInit | null = null
// Mientras se prepara la grabación (pantalla, cámara…) todavía no hay barra, pero ya está en marcha
let starting = false

/**
 * Archivo de la grabación en curso. La barra envía el vídeo en trozos de 1 s y se van añadiendo
 * aquí, así que nunca hay una grabación entera en memoria y, si algo falla, se conserva lo grabado.
 */
interface Output {
  file: string
  handle: FileHandle
  /** Escrituras en orden: cada trozo espera a que termine el anterior */
  queue: Promise<void>
  failed: unknown
}
let out: Output | null = null

export function isRecording(): boolean {
  return bar !== null || starting
}

/**
 * Pide a la barra de grabación que termine (p. ej. al pulsar el atajo global otra vez).
 * Si aún se está preparando, se cancela el arranque.
 */
export function stopRecording(): void {
  if (bar) sendTo(bar.webContents, 'recorder:stop')
  else if (starting) {
    starting = false
    void discardOutput(cleanup())
  }
}

/** Cierra las ventanas de la grabación y devuelve su archivo (para guardarlo o descartarlo). */
function cleanup(): Output | null {
  stopInputHook()
  // Se sueltan antes de destruirlas: así los avisos que lleguen al cerrarlas ya no las reconocen
  const wins = [bar, frame, cam]
  bar = frame = cam = null
  init = null
  for (const w of wins) if (w && !w.isDestroyed()) w.destroy()
  const o = out
  out = null
  return o
}

/** Termina la grabación por un error: avisa y guarda lo que se haya grabado hasta ese momento. */
function recordingFailed(text: string, err?: unknown): void {
  const o = cleanup()
  logError(text, err)
  dialog.showErrorBox('Error al grabar', text)
  if (o) void finishOutput(o)
}

async function openOutput(): Promise<Output> {
  const file = await writeNewFile(tempDir(), recordingName('webm'), new Uint8Array())
  return { file, handle: await open(file, 'a'), queue: Promise.resolve(), failed: null }
}

function appendChunk(o: Output, chunk: Buffer): void {
  o.queue = o.queue
    .then(async () => {
      if (!o.failed) await o.handle.write(chunk)
    })
    .catch((err) => {
      o.failed = err
    })
}

async function closeOutput(o: Output): Promise<number> {
  await o.queue
  await o.handle.close().catch(() => {})
  return stat(o.file).then(
    (s) => s.size,
    () => 0
  )
}

async function discardOutput(o: Output | null): Promise<void> {
  if (!o) return
  await closeOutput(o)
  await unlink(o.file).catch(() => {})
}

/** Cierra el archivo y, si tiene vídeo, lo repara, lo añade al historial y muestra la vista previa. */
async function finishOutput(o: Output): Promise<void> {
  const size = await closeOutput(o)
  if (o.failed) {
    logError('Grabación: no se pudo escribir en el disco', o.failed)
    dialog.showErrorBox('Error al grabar', `No se pudo guardar la grabación completa en ${o.file}.`)
  }
  if (size === 0) {
    await unlink(o.file).catch(() => {})
    return
  }
  await fixWebm(o.file)
  void addVideoToHistory(o.file)
  showPreview({ kind: 'video', path: o.file, src: mediaUrl(o.file), width: 0, height: 0 })
}

/** Burbuja con la webcam: es una ventana real en pantalla, así que sale en la grabación. */
function openWebcam(display: Display, abs: Rect): void {
  const size = CAM_SIZES.m
  const margin = 16
  // Abajo a la izquierda dentro de la región (si cabe); si no, junto a ella
  const inside = abs.width > size * 2 && abs.height > size * 1.5
  const wa = display.workArea
  let x = inside ? abs.x + margin : abs.x - size - margin
  let y = inside ? abs.y + abs.height - size - margin : abs.y + abs.height - size
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - size)
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - size)
  cam = createWindow('webcam', {
    x: Math.round(x),
    y: Math.round(y),
    width: size,
    height: size,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Cámara'
  })
  cam.setAlwaysOnTop(true, 'screen-saver')
  cam.once('ready-to-show', () => cam?.showInactive())
}

export async function startRecording(display: Display, rect: Rect, state: OverlayState): Promise<void> {
  if (bar || starting) return
  starting = true
  try {
    await prepareRecording(display, rect, state)
  } catch (err) {
    recordingFailed('No se pudo empezar a grabar.', err)
  } finally {
    starting = false
  }
}

async function prepareRecording(display: Display, rect: Rect, state: OverlayState): Promise<void> {
  const sourceId = await screenSourceId(display)
  if (!starting) return // se canceló mientras tanto
  if (!sourceId) {
    dialog.showErrorBox('No se puede grabar', 'No se encontró la pantalla seleccionada.')
    return
  }
  const sf = display.scaleFactor
  const crop = physicalCrop(display, rect)
  init = {
    sourceId,
    screenWidth: Math.round(display.bounds.width * sf),
    screenHeight: Math.round(display.bounds.height * sf),
    crop,
    mic: state.mic,
    sysAudio: state.sysAudio,
    clicks: state.clicks,
    keys: state.keys
  }

  const abs = absRect(display, rect)
  if (!isFullScreen(display, rect)) frame = createRegionFrame(abs)
  // La cámara se abre antes de empezar a grabar: al arrancar bloquea un momento la captura
  // de vídeo y, si se hiciera a la vez, el principio de la grabación tendría saltos
  if (state.camera) {
    openWebcam(display, abs)
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      once('webcam:ready', (_e, ready: unknown) => {
        clearTimeout(timer)
        resolve(ready === true)
      })
    })
    if (!ok) {
      if (cam && !cam.isDestroyed()) cam.destroy()
      cam = null
      if (Notification.isSupported())
        new Notification({ title: 'Grabando sin cámara', body: 'No se encontró ninguna cámara disponible.' }).show()
    }
    if (!starting) return // se canceló mientras tanto
  }

  const o = await openOutput()
  if (!starting) return void discardOutput(o) // se canceló mientras tanto
  out = o

  const b = createControlBar('recorder', display, abs, BAR_W, BAR_H)
  bar = b
  // Si la barra se cierra o deja de funcionar, se avisa y se guarda lo grabado hasta ese momento
  b.on('closed', () => {
    if (bar === b) recordingFailed('La barra de grabación se cerró inesperadamente.')
  })
  b.webContents.on('render-process-gone', (_e, details) => {
    if (bar === b) recordingFailed('La grabación se ha interrumpido inesperadamente.', details.reason)
  })

  // Clics y teclas: se envían a la barra, que los dibuja dentro del vídeo
  if (state.clicks || state.keys) {
    const origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
    const region = { x: origin.x + crop.x, y: origin.y + crop.y, width: crop.width, height: crop.height }
    const target = b
    startInputHook(region, { clicks: state.clicks, keys: state.keys }, (ev) => {
      if (!target.isDestroyed()) sendTo(target.webContents, 'recorder:input', ev)
    })
  }
}

export function registerRecorderIpc(): void {
  handle('recorder:init', () => init)

  on('recorder:chunk', (_e, raw: unknown) => {
    const buf = toBuffer(raw)
    if (out && buf?.byteLength) appendChunk(out, buf)
  })

  // Los trozos llegan antes que este aviso (mismo canal, en orden)
  handle('recorder:done', async () => {
    const o = cleanup()
    if (!o) return
    await finishOutput(o)
  })

  on('recorder:cancel', () => void discardOutput(cleanup()))

  on('recorder:error', (_e, message: unknown) => {
    recordingFailed(typeof message === 'string' ? message.slice(0, 500) : 'Error desconocido')
  })

  // Tamaño de la burbuja de la cámara (S/M/L), manteniendo su centro
  on('webcam:size', (_e, key: unknown) => {
    if (!cam || cam.isDestroyed()) return
    const b = cam.getBounds()
    const s = key === 's' || key === 'm' || key === 'l' ? CAM_SIZES[key] : CAM_SIZES.m
    cam.setBounds({ x: Math.round(b.x + b.width / 2 - s / 2), y: Math.round(b.y + b.height / 2 - s / 2), width: s, height: s })
  })
  on('webcam:close', () => {
    if (cam && !cam.isDestroyed()) cam.destroy()
    cam = null
  })
}
