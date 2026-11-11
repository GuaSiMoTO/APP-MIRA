import type { CaptureMode, OverlayInit, OverlayState, Rect } from '../../shared/types'
import { $, api, waitFor } from '../shared/api'
import { bytesUrl } from '../shared/bytes'
import { logoImg } from '../shared/brand'
import { icons } from '../shared/icons'

const bg = $<HTMLImageElement>('#bg')
const sel = $('#sel')
const sizeLabel = $('#size')
const crossH = $('#cross-h')
const crossV = $('#cross-v')
const loupe = $<HTMLCanvasElement>('#loupe')
const toolbar = $('#toolbar')
const hint = $('#hint')
const recActions = $('#rec-actions')
const badge = $('#screen-badge')

let init: OverlayInit
let state: OverlayState
let ratio = 1 // píxeles físicos por píxel CSS

let dragStart: { x: number; y: number } | null = null
let current: Rect | null = null
let pendingVideo = false
let mouse = { x: -1, y: -1 }

const modeLabels: Record<CaptureMode, string> = {
  region: 'Región',
  window: 'Ventana',
  screen: 'Pantalla completa',
  scroll: 'Captura con desplazamiento (página o chat entero)'
}

const MODES: Record<OverlayState['kind'], CaptureMode[]> = {
  photo: ['region', 'window', 'screen', 'scroll'],
  video: ['region', 'screen'],
  text: ['region', 'window']
}

/** Modos en los que se arrastra para seleccionar */
const isDrag = () => state.mode === 'region' || state.mode === 'scroll'

/** Texto del botón de confirmación según lo que se va a hacer */
function confirmLabel(): string {
  if (state.kind === 'video') return 'Grabar'
  if (state.kind === 'text') return 'Copiar texto'
  return state.mode === 'scroll' ? 'Empezar' : 'Capturar'
}

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

function showRect(r: Rect | null, label?: string, kind: 'region' | 'window' = 'region'): void {
  current = r
  document.body.classList.toggle('has-sel', !!r)
  sel.hidden = !r
  if (!r) return
  sel.classList.toggle('window', kind === 'window')
  Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
  sizeLabel.textContent = label ?? `${Math.round(r.width * ratio)} × ${Math.round(r.height * ratio)}`
  sizeLabel.classList.toggle('inside', r.y < 32)
}

/** Esquema de las pantallas (como están colocadas) para elegir cuál capturar en "Pantalla completa". */
function screensHtml(): string {
  const list = init.screens
  if (state.mode !== 'screen' || list.length < 2) return ''
  const minX = Math.min(...list.map((s) => s.bounds.x))
  const minY = Math.min(...list.map((s) => s.bounds.y))
  const W = Math.max(...list.map((s) => s.bounds.x + s.bounds.width)) - minX
  const H = Math.max(...list.map((s) => s.bounds.y + s.bounds.height)) - minY
  const k = Math.min(30 * list.length / W, 34 / H) // escala del esquema
  const verb = state.kind === 'video' ? 'Grabar' : state.kind === 'text' ? 'Leer el texto de' : 'Capturar'
  const boxes = list
    .map(
      (s) => `<button class="mon ${s.id === init.displayId ? 'here' : ''}" data-screen="${s.id}" title="${verb} la pantalla ${s.index} · ${s.width}×${s.height}${s.primary ? ' (principal)' : ''}"
        style="left:${(s.bounds.x - minX) * k}px;top:${(s.bounds.y - minY) * k}px;width:${s.bounds.width * k - 3}px;height:${s.bounds.height * k - 3}px">${s.index}</button>`
    )
    .join('')
  return `<div class="sep"></div><div class="monitors" style="width:${W * k}px;height:${H * k}px">${boxes}</div>${
    state.kind === 'photo' ? '<button class="all-btn" data-screen="all" title="Unir todas las pantallas en una sola imagen">Todas</button>' : ''
  }`
}

/** Número grande en el centro de cada pantalla (modo pantalla completa). */
function renderBadge(): void {
  const me = init.screens.find((s) => s.id === init.displayId)
  const show = state.mode === 'screen' && !!me && !pendingVideo
  badge.hidden = !show
  if (!show || !me) return
  const verb = state.kind === 'video' ? 'grabarla' : state.kind === 'text' ? 'leer su texto' : 'capturarla'
  badge.innerHTML = `<b>${me.index}</b><span>Pantalla ${me.index}${me.primary ? ' · principal' : ''}</span><small>${me.width} × ${me.height} · haz clic para ${verb}</small>`
}

function renderToolbar(): void {
  if (!init.showToolbar) return
  const isVideo = state.kind === 'video'
  const modes = MODES[state.kind]
  const modeIcon = { region: icons.region, window: icons.window, screen: icons.screen, scroll: icons.scroll }
  const toggle = (key: 'mic' | 'sysAudio' | 'clicks' | 'keys' | 'camera', icon: string, label: string) =>
    `<button class="icon-btn ${state[key] ? 'active' : ''}" data-toggle="${key}" title="${label}: ${state[key] ? 'sí' : 'no'}">${icon}</button>`
  toolbar.innerHTML = `
    ${logoImg()}
    <div class="seg">
      <button data-kind="photo" class="${state.kind === 'photo' ? 'active' : ''}" title="Capturar imagen">${icons.camera}<span>Foto</span></button>
      <button data-kind="video" class="video ${isVideo ? 'active' : ''}" title="Grabar vídeo">${icons.video}<span>Vídeo</span></button>
      <button data-kind="text" class="${state.kind === 'text' ? 'active' : ''}" title="Copiar el texto de una zona (OCR)">${icons.textScan}<span>Texto</span></button>
    </div>
    <div class="sep"></div>
    ${modes
      .map(
        (m) =>
          `<button class="icon-btn ${state.mode === m ? 'active' : ''}" data-mode="${m}" title="${modeLabels[m]}">${modeIcon[m]}</button>`
      )
      .join('')}
    <div class="sep"></div>
    ${
      isVideo
        ? `${toggle('mic', icons.mic, 'Micrófono')}
           ${toggle('sysAudio', icons.speaker, 'Audio del sistema')}
           <div class="sep"></div>
           ${toggle('clicks', icons.cursorClick, 'Mostrar clics en el vídeo')}
           ${toggle('keys', icons.keyboard, 'Mostrar teclas pulsadas en el vídeo')}
           ${toggle('camera', icons.camera2, 'Webcam en burbuja')}`
        : state.kind === 'text'
          ? ''
          : `<select id="delay" title="Retardo">
             <option value="0">Sin retardo</option>
             <option value="3">Retardo 3 s</option>
             <option value="5">Retardo 5 s</option>
             <option value="10">Retardo 10 s</option>
           </select>`
    }
    ${screensHtml()}
    ${init.hasLastRegion && state.mode !== 'screen' ? `<div class="sep"></div><button class="icon-btn" data-last title="Usar la última región">${icons.repeat}</button>` : ''}
    <div class="sep"></div>
    <button class="icon-btn" data-close title="Cancelar (Esc)">${icons.close}</button>`
  toolbar.hidden = false
}

function renderHint(): void {
  if (!init.showToolbar) return
  const verb = state.kind === 'video' ? 'grabar' : state.kind === 'text' ? 'leer' : 'capturar'
  const text: Record<CaptureMode, string> = {
    region: state.kind === 'text' ? 'Arrastra sobre el texto que quieres copiar' : `Arrastra para seleccionar la región que quieres ${verb}`,
    window: state.kind === 'text' ? 'Haz clic en una ventana para copiar su texto' : `Haz clic en una ventana para ${verb}la`,
    screen:
      init.screens.length > 1
        ? `Tienes ${init.screens.length} pantallas: haz clic en la que quieras ${verb} o elígela en el esquema de arriba`
        : `Haz clic para ${verb} la pantalla completa`,
    scroll: 'Selecciona la zona que se desplaza (la página o el chat); después se desplazará sola'
  }
  hint.textContent = `${text[state.mode]} · Esc para cancelar`
  hint.hidden = pendingVideo
}

function applyMode(): void {
  if (!MODES[state.kind].includes(state.mode)) state.mode = 'region'
  document.body.classList.toggle('pick', !isDrag())
  const showCross = isDrag() && !pendingVideo
  crossH.hidden = crossV.hidden = !showCross || mouse.x < 0
  loupe.hidden = !showCross || mouse.x < 0 || !!dragStart
  if (!dragStart && !pendingVideo) showRect(null)
  renderToolbar()
  renderHint()
  renderBadge()
  if (mouse.x >= 0) hover(mouse.x, mouse.y)
}

function setState(patch: Partial<OverlayState>): void {
  cancelPendingVideo()
  state = { ...state, ...patch }
  applyMode()
  api.send('overlay:state', state)
}

function windowAt(x: number, y: number) {
  return init.windows.find((w) => x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height)
}

function screenRect(): Rect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

function drawLoupe(x: number, y: number): void {
  const ctx = loupe.getContext('2d')!
  const zoom = 8
  const src = loupe.width / zoom
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, loupe.width, loupe.height)
  ctx.drawImage(bg, x * ratio - src / 2, y * ratio - src / 2, src, src, 0, 0, loupe.width, loupe.height)
  ctx.strokeStyle = 'rgba(91,124,250,.9)'
  ctx.lineWidth = 1
  const c = loupe.width / 2
  ctx.strokeRect(c - zoom / 2 + 0.5, c - zoom / 2 + 0.5, zoom - 1, zoom - 1)
  // Posición: abajo a la derecha del cursor, o al lado contrario si no cabe
  const off = 24
  let lx = x + off
  let ly = y + off
  if (lx + 132 > window.innerWidth) lx = x - off - 132
  if (ly + 132 > window.innerHeight) ly = y - off - 132
  loupe.style.left = `${lx}px`
  loupe.style.top = `${ly}px`
}

function hover(x: number, y: number): void {
  if (pendingVideo) return
  if (isDrag()) {
    crossH.hidden = crossV.hidden = false
    crossH.style.top = `${y}px`
    crossV.style.left = `${x}px`
    if (!dragStart) {
      loupe.hidden = false
      drawLoupe(x, y)
    }
  } else if (state.mode === 'window') {
    const w = windowAt(x, y)
    showRect(w ?? null, w ? `${w.title} · ${Math.round(w.width * ratio)} × ${Math.round(w.height * ratio)}` : undefined, 'window')
  } else {
    showRect(screenRect(), undefined, 'window')
  }
}

function finish(rect: Rect): void {
  api.send('overlay:done', { displayId: init.displayId, rect })
}

function cancelPendingVideo(): void {
  pendingVideo = false
  recActions.hidden = true
}

/** Descarta la selección pendiente y vuelve a seleccionar desde cero. */
function resetSelection(): void {
  cancelPendingVideo()
  showRect(null)
  applyMode()
}

function askToRecord(r: Rect): void {
  pendingVideo = true
  const start = $('#rec-start')
  start.innerHTML = `${state.kind === 'video' ? '<span class="dot"></span>' : ''}${confirmLabel()}`
  start.classList.toggle('red', state.kind === 'video')
  crossH.hidden = crossV.hidden = loupe.hidden = true
  hint.hidden = true
  recActions.hidden = false
  const w = recActions.offsetWidth
  const h = recActions.offsetHeight
  let x = r.x + r.width / 2 - w / 2
  let y = r.y + r.height + 12
  if (y + h > window.innerHeight - 8) y = r.y - h - 12
  if (y < 8) y = r.y + r.height / 2 - h / 2
  x = Math.min(Math.max(x, 8), window.innerWidth - w - 8)
  recActions.style.left = `${x}px`
  recActions.style.top = `${y}px`
}

function complete(r: Rect): void {
  if (state.kind === 'video') askToRecord(r)
  else finish(r)
}

// ---------- Eventos ----------

window.addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY }
  if (dragStart) {
    showRect(normalize(dragStart, mouse))
    crossH.style.top = `${e.clientY}px`
    crossV.style.left = `${e.clientX}px`
    return
  }
  if ((e.target as HTMLElement).closest('#toolbar')) {
    loupe.hidden = true
    return
  }
  hover(e.clientX, e.clientY)
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('#toolbar, #rec-actions')) return
  if (pendingVideo) {
    resetSelection()
  }
  if (isDrag()) {
    dragStart = { x: e.clientX, y: e.clientY }
    loupe.hidden = true
    showRect({ ...dragStart, width: 0, height: 0 })
  }
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('#toolbar, #rec-actions')) return
  if (isDrag()) {
    if (!dragStart) return
    const r = normalize(dragStart, { x: e.clientX, y: e.clientY })
    dragStart = null
    if (r.width < 4 || r.height < 4) {
      showRect(null)
      hover(e.clientX, e.clientY)
      return
    }
    complete(r)
  } else if (state.mode === 'window') {
    const w = windowAt(e.clientX, e.clientY)
    if (w) complete({ x: w.x, y: w.y, width: w.width, height: w.height })
  } else {
    complete(screenRect())
  }
})

window.addEventListener('mouseleave', () => {
  crossH.hidden = crossV.hidden = loupe.hidden = true
  if (!isDrag() && !pendingVideo) showRect(null)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (pendingVideo) {
      resetSelection()
    } else api.send('overlay:cancel')
  } else if (e.key === 'Enter' && pendingVideo && current) {
    finish(current)
  }
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  api.send('overlay:cancel')
})

toolbar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  if (btn.dataset.kind) setState({ kind: btn.dataset.kind as OverlayState['kind'] })
  else if (btn.dataset.mode) setState({ mode: btn.dataset.mode as CaptureMode })
  else if (btn.dataset.toggle) {
    const key = btn.dataset.toggle as 'mic' | 'sysAudio' | 'clicks' | 'keys' | 'camera'
    setState({ [key]: !state[key] })
  } else if (btn.dataset.screen) {
    api.send('overlay:pick-screen', btn.dataset.screen === 'all' ? 'all' : Number(btn.dataset.screen))
  } else if ('last' in btn.dataset) {
    api.send('overlay:use-last')
  } else if ('close' in btn.dataset) api.send('overlay:cancel')
})

toolbar.addEventListener('change', (e) => {
  const t = e.target as HTMLSelectElement
  if (t.id === 'delay' && Number(t.value) > 0) api.send('overlay:delay', Number(t.value))
})

$('#rec-start').addEventListener('click', () => current && finish(current))
$('#rec-redo').addEventListener('click', () => {
  resetSelection()
})

// Marcar la última región (puede venir de la barra de otra pantalla) y pedir confirmación
api.on('overlay:select-last', () => {
  if (!init.lastRegion) return
  cancelPendingVideo()
  showRect(init.lastRegion)
  askToRecord(init.lastRegion)
})

api.on('overlay:state', (s: OverlayState) => {
  state = s
  cancelPendingVideo()
  applyMode()
})

// ---------- Arranque ----------

async function boot(): Promise<void> {
  init = await waitFor('overlay:init')
  state = init.state
  bg.src = bytesUrl(init.image, 'image/jpeg')
  await bg.decode()
  ratio = bg.naturalWidth / window.innerWidth
  applyMode()
  api.send('overlay:ready')
}

// Si no se puede pintar la captura congelada, se cancela (si no, la sesión quedaría ocupada)
boot().catch((err) => {
  console.error('No se pudo preparar la superposición', err)
  api.send('overlay:cancel')
})
