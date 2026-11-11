import { BrowserWindow, desktopCapturer, dialog, nativeImage, screen, type Display, type NativeImage } from 'electron'
import type { OverlayInit, OverlayState, Rect, ScreenInfo } from '../shared/types'
import { finishImage } from './output'
import { isRecording, startRecording } from './recorder'
import { isScrolling, startScrollCapture } from './scroll'
import { recognizeAndShow } from './textcard'
import { getSettings, pickState, updateSettings } from './settings'
import { isNum, isObj, isRect, oneOf } from './validate'
import { listWindows } from './winapi'
import { createWindow, ready } from './windows'
import { on, sendTo } from './ipc'
import { logError } from './log'

/** Tiempo máximo para que la superposición aparezca antes de dar la captura por fallida. */
const OVERLAY_TIMEOUT_MS = 10_000

interface Session {
  overlays: Map<number, BrowserWindow>
  shots: Map<number, NativeImage>
  displays: Map<number, Display>
  state: OverlayState
}

let session: Session | null = null
let starting = false

function physicalSize(d: Display) {
  return { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) }
}

/** Captura cada pantalla a su resolución nativa. */
async function grabScreens(displays: Display[]): Promise<Map<number, NativeImage>> {
  const result = new Map<number, NativeImage>()
  const bySize = new Map<string, Display[]>()
  for (const d of displays) {
    const s = physicalSize(d)
    const key = `${s.width}x${s.height}`
    bySize.set(key, [...(bySize.get(key) ?? []), d])
  }
  for (const group of bySize.values()) {
    const size = physicalSize(group[0])
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    for (const d of group) {
      const src =
        sources.find((s) => s.display_id === String(d.id)) ??
        (sources.length === 1 && displays.length === 1 ? sources[0] : undefined)
      if (src) result.set(d.id, src.thumbnail)
    }
  }
  return result
}

function ownWindowHandles(): Set<bigint> {
  const set = new Set<bigint>()
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      set.add(w.getNativeWindowHandle().readBigUInt64LE(0))
    } catch {
      /* ignorar */
    }
  }
  return set
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.width, b.x + b.width)
  const btm = Math.min(a.y + a.height, b.y + b.height)
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null
}

export async function startCapture(override: Partial<OverlayState> = {}): Promise<void> {
  if (session || starting) return
  if (isRecording() || isScrolling()) return
  starting = true
  try {
    const settings = getSettings()
    const state: OverlayState = { ...settings.lastState, ...override, delay: 0 }
    const displays = screen.getAllDisplays()
    const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

    const own = ownWindowHandles()
    const windows = listWindows()
      .filter((w) => !own.has(w.handle))
      .map((w) => ({ ...screen.screenToDipRect(null, w), title: w.title }))

    const shots = await grabScreens(displays)
    const s: Session = { overlays: new Map(), shots, displays: new Map(), state }
    // Pantallas numeradas de izquierda a derecha (y de arriba abajo)
    const primaryId = screen.getPrimaryDisplay().id
    const screens: ScreenInfo[] = [...displays]
      .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      .map((d, i) => ({
        id: d.id,
        index: i + 1,
        bounds: d.bounds,
        width: Math.round(d.bounds.width * d.scaleFactor),
        height: Math.round(d.bounds.height * d.scaleFactor),
        primary: d.id === primaryId
      }))

    for (const d of displays) {
      const shot = shots.get(d.id)
      if (!shot) continue
      s.displays.set(d.id, d)
      const win = createWindow('overlay', {
        ...d.bounds,
        frame: false,
        backgroundColor: '#000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        thickFrame: false,
        roundedCorners: false
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setBounds(d.bounds)
      s.overlays.set(d.id, win)
      // Si una superposición se cierra por su cuenta (Alt+F4) o deja de funcionar, se termina
      // la sesión entera; si no, el atajo no volvería a responder hasta reiniciar
      win.on('closed', () => {
        if (session === s) closeOverlays()
      })
      win.webContents.on('render-process-gone', (_e, details) => {
        if (session !== s) return
        logError('La superposición de captura dejó de funcionar', details.reason)
        closeOverlays()
      })

      const local: OverlayInit['windows'] = []
      for (const w of windows) {
        const r = intersect(w, d.bounds)
        if (r) local.push({ x: r.x - d.bounds.x, y: r.y - d.bounds.y, width: r.width, height: r.height, title: w.title })
      }
      const init: OverlayInit = {
        displayId: d.id,
        image: shot.toJPEG(95),
        windows: local,
        showToolbar: d.id === active.id,
        state,
        lastRegion: settings.lastRegion?.displayId === d.id ? settings.lastRegion.rect : null,
        hasLastRegion: !!settings.lastRegion && displays.some((x) => x.id === settings.lastRegion!.displayId),
        screens
      }
      void ready(win).then(() => {
        if (!win.isDestroyed()) sendTo(win.webContents, 'overlay:init', init)
      })
    }
    if (s.overlays.size === 0) {
      logError('Captura: no se obtuvo la imagen de ninguna pantalla')
      dialog.showErrorBox('No se puede capturar', 'No se pudo obtener la imagen de la pantalla.')
      return
    }
    session = s
    // Red de seguridad: si ninguna superposición llega a mostrarse (la página no carga o falla
    // al pintar la captura), se cierra la sesión para que el atajo vuelva a funcionar
    setTimeout(() => {
      if (session !== s) return
      if ([...s.overlays.values()].some((w) => !w.isDestroyed() && w.isVisible())) return
      logError('Captura: la superposición no llegó a mostrarse')
      closeOverlays()
    }, OVERLAY_TIMEOUT_MS)
  } catch (err) {
    logError('No se pudo iniciar la captura', err)
  } finally {
    starting = false
  }
}

function closeOverlays(): Session | null {
  const s = session
  session = null
  if (s) for (const w of s.overlays.values()) if (!w.isDestroyed()) w.destroy()
  return s
}

export function isCapturing(): boolean {
  return session !== null
}

const isDelay = oneOf([3, 5, 10] as const)

export function registerCaptureIpc(): void {
  // La superposición ya pintó la captura congelada: se muestra sin parpadeo
  on('overlay:ready', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || !session) return
    win.show()
    const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    if (session.overlays.get(active.id) === win) win.focus()
  })

  on('overlay:state', (e, raw: unknown) => {
    if (!session) return
    const state = pickState(raw, session.state)
    session.state = state
    updateSettings({ lastState: { ...state, delay: 0 } })
    for (const w of session.overlays.values()) if (w.webContents !== e.sender) sendTo(w.webContents, 'overlay:state', state)
  })

  on('overlay:cancel', () => closeOverlays())

  // Pantalla completa elegida en el esquema de la barra (o "all" = todas en una imagen)
  on('overlay:pick-screen', async (_e, id: unknown) => {
    if (id !== 'all' && !isNum(id)) return
    const s = closeOverlays()
    if (!s) return
    if (id === 'all') {
      if (s.state.kind === 'photo') await finishImage(composeAllScreens(s))
      return
    }
    const display = s.displays.get(id)
    const shot = s.shots.get(id)
    if (!display || !shot) return
    await useSelection(s, display, shot, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height })
  })

  // "Última región": la marca la superposición de la pantalla donde se capturó
  on('overlay:use-last', () => {
    const last = getSettings().lastRegion
    const win = last && session?.overlays.get(last.displayId)
    if (!win || win.isDestroyed()) return
    win.focus()
    sendTo(win.webContents, 'overlay:select-last')
  })

  on('overlay:delay', (_e, seconds: unknown) => {
    if (!isDelay(seconds)) return
    const s = closeOverlays()
    setTimeout(() => void startCapture(s?.state), seconds * 1000)
  })

  on('overlay:done', async (_e, result: unknown) => {
    if (!isObj(result) || !isNum(result.displayId) || !isRect(result.rect)) return
    const s = closeOverlays()
    if (!s) return
    const display = s.displays.get(result.displayId)
    const shot = s.shots.get(result.displayId)
    if (!display || !shot) return
    const r = result.rect
    if (r.width < 2 || r.height < 2) return

    if (s.state.mode !== 'screen') updateSettings({ lastRegion: { displayId: display.id, rect: r } })
    await useSelection(s, display, shot, r)
  })
}

/**
 * Qué hacer con la zona elegida (coordenadas locales de la pantalla) según el modo:
 * grabar vídeo, captura con desplazamiento, leer el texto o capturar la imagen.
 */
async function useSelection(s: Session, display: Display, shot: NativeImage, r: Rect): Promise<void> {
  if (s.state.kind === 'video') return void startRecording(display, r, s.state)
  if (s.state.kind === 'photo' && s.state.mode === 'scroll') return void startScrollCapture(display, r)
  const whole = r.x === 0 && r.y === 0 && r.width === display.bounds.width && r.height === display.bounds.height
  const img = whole ? shot : cropShot(shot, display, r)
  if (s.state.kind === 'text') return recognizeAndShow(img)
  await finishImage(img, { x: display.bounds.x + r.x, y: display.bounds.y + r.y, width: r.width, height: r.height })
}

/** Une todas las pantallas en una sola imagen, colocadas como en la configuración de Windows. */
function composeAllScreens(s: Session): NativeImage {
  const ds = [...s.displays.values()]
  const sf = Math.max(...ds.map((d) => d.scaleFactor))
  const minX = Math.min(...ds.map((d) => d.bounds.x))
  const minY = Math.min(...ds.map((d) => d.bounds.y))
  const W = Math.round((Math.max(...ds.map((d) => d.bounds.x + d.bounds.width)) - minX) * sf)
  const H = Math.round((Math.max(...ds.map((d) => d.bounds.y + d.bounds.height)) - minY) * sf)
  const out = Buffer.alloc(W * H * 4) // los huecos entre pantallas quedan transparentes
  for (const d of ds) {
    const shot = s.shots.get(d.id)
    if (!shot) continue
    const tw = Math.round(d.bounds.width * sf)
    const th = Math.round(d.bounds.height * sf)
    const img = shot.getSize().width === tw ? shot : shot.resize({ width: tw, height: th, quality: 'best' })
    const bmp = img.toBitmap()
    const sz = img.getSize()
    const ox = Math.round((d.bounds.x - minX) * sf)
    const oy = Math.round((d.bounds.y - minY) * sf)
    for (let y = 0; y < sz.height && oy + y < H; y++) {
      const w = Math.min(sz.width, W - ox) * 4
      bmp.copy(out, ((oy + y) * W + ox) * 4, y * sz.width * 4, y * sz.width * 4 + w)
    }
  }
  return nativeImage.createFromBitmap(out, { width: W, height: H })
}

function cropShot(shot: NativeImage, display: Display, r: Rect): NativeImage {
  const sf = shot.getSize().width / display.bounds.width
  return shot.crop({
    x: Math.round(r.x * sf),
    y: Math.round(r.y * sf),
    width: Math.round(r.width * sf),
    height: Math.round(r.height * sf)
  })
}

// Una repetición en marcha: mantener pulsado el atajo no debe lanzar varias capturas
let repeating = false

/** Vuelve a capturar la última región sin abrir la superposición. */
export async function repeatLastRegion(): Promise<void> {
  if (repeating || session || starting || isRecording() || isScrolling()) return
  repeating = true
  try {
    const last = getSettings().lastRegion
    const display = last && screen.getAllDisplays().find((d) => d.id === last.displayId)
    // La región debe seguir cabiendo en la pantalla (puede haber cambiado la resolución);
    // si no, se pide una nueva
    const r = last?.rect
    const fits = !!display && !!r && r.x >= 0 && r.y >= 0 && r.x + r.width <= display.bounds.width && r.y + r.height <= display.bounds.height
    if (!display || !r || !fits) {
      void startCapture({ kind: 'photo', mode: 'region' })
      return
    }
    const shot = (await grabScreens([display])).get(display.id)
    if (!shot) {
      logError('Repetir región: no se obtuvo la imagen de la pantalla')
      return
    }
    const img = cropShot(shot, display, r)
    if (img.isEmpty()) {
      logError('Repetir región: la región no contiene imagen')
      void startCapture({ kind: 'photo', mode: 'region' })
      return
    }
    await finishImage(img, { x: display.bounds.x + r.x, y: display.bounds.y + r.y, width: r.width, height: r.height })
  } catch (err) {
    logError('Repetir región', err)
  } finally {
    repeating = false
  }
}
