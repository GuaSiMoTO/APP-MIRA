import Konva from 'konva'
import { $, api, reportError } from '../shared/api'
import { canvasBytes } from '../shared/bytes'
import { LOGO_URL } from '../shared/brand'
import { closeColorPicker, openColorPicker, pickScreenColor } from '../shared/colorpicker'
import { icons, type IconName } from '../shared/icons'
import {
  blur,
  canvasOf,
  clampRect,
  backgroundCss,
  bgLayout,
  composeBackground,
  contentBox,
  crop,
  fillSolid,
  pixelate,
  removeArea,
  type Background,
  type BgAlign,
  type BgRatio,
  type IRect
} from './effects'
import { constrain, edgeProfiles, simplify, snapTo, textBandAt } from './analysis'
import { MiraArrow } from './arrow'
import {
  BACKGROUNDS,
  COLORS,
  COUNTER_R,
  FILLABLE,
  FONT_SIZES,
  PLAIN_STYLES,
  RESIZABLE,
  SIZES,
  TEXTUAL,
  TOOLBAR,
  TOOLS,
  cropRatioValue,
  isLight,
  toolDef,
  type ArrowStyle,
  type BubbleDir,
  type CropRatio,
  type Fillable,
  type PaintMode,
  type TextStyle,
  type Tool,
  type ToolGroup
} from './config'
import {
  busyHtml,
  cropActiveHtml,
  cropToolHtml,
  effectiveColorTarget,
  hintHtml,
  magnifierHtml,
  removeHtml,
  shapeHtml,
  spotlightHtml,
  textHtml
} from './ctxbar'
import { runInpaint } from './inpaint'
import { magnifierCanvas, magPad } from './magnifier'
import { findSensitive, summarize } from './sensitive'
import { loadBg, loadPresets, saveBg as storeBg, savePresets as storePresets } from './storage'
import { resizeCanvas, scaleNodes, transformCanvas, transformNodes, type Op } from './transform'

const groupLast: Record<string, Tool> = { shapes: 'rect', draw: 'pen', hide: 'pixelate', focus: 'spotlight' }

// ---------- Estado ----------

let base: HTMLCanvasElement = canvasOf(1, 1)
const unit = Math.max(1, window.devicePixelRatio || 1)
let scale = 1
let tool: Tool = 'arrow'
let color = COLORS[0] // color del borde / trazo
let sizeIdx = 1

// Borde y relleno de rectángulos, elipses y flechas
let fillColor = COLORS[0]
let fillLinked = true // mientras no se elija un relleno propio, sigue al color del borde
let colorTarget: 'stroke' | 'fill' = 'stroke'
const paintMode: Record<Fillable, PaintMode> = { rect: 'stroke', ellipse: 'stroke', arrow: 'both' }

// Quitar objeto: rellenar con la textura del entorno o con un color plano
let removeMode: 'texture' | 'solid' = 'texture'
let solidColor: string | null = null // null = automático (color medio del borde)
let busy = false
let busyText = ''

// Texto: simple, con fondo o bocadillo (y hacia dónde apunta la colita)
let textStyle: TextStyle = 'plain'
let bubbleDir: BubbleDir = 'down'
// Foco (oscuridad del resto) y lupa (aumento)
let spotDim = 0.55
let magZoom = 2
// Flecha: normal, fina, gruesa o doble punta
let arrowStyle: ArrowStyle = 'standard'

const bg: Background = loadBg()

// ---------- Konva ----------

const stageEl = $('#stage')
const decor = $('#decor')
const frameEl = $('#frame')

const stage = new Konva.Stage({ container: stageEl as HTMLDivElement, width: 1, height: 1 })
const layer = new Konva.Layer()
const baseNode = new Konva.Image({ image: base, listening: false })
const ann = new Konva.Group()
layer.add(baseNode)

// Oscurece todo menos los rectángulos de foco (se calcula en un lienzo aparte para que
// varios focos solapados no se anulen entre sí)
let dimCanvas: HTMLCanvasElement | null = null
const dim = new Konva.Shape({
  listening: false,
  sceneFunc(ctx) {
    const spots = ann.getChildren((n) => n.name() === 'spotlight')
    if (!spots.length) return
    if (!dimCanvas || dimCanvas.width !== base.width || dimCanvas.height !== base.height) dimCanvas = canvasOf(base.width, base.height)
    const d = dimCanvas.getContext('2d')!
    d.globalCompositeOperation = 'source-over'
    d.clearRect(0, 0, dimCanvas.width, dimCanvas.height)
    const level = Math.max(...spots.map((s) => Number((s as Konva.Node).getAttr('dim') ?? spotDim)))
    d.fillStyle = `rgba(0,0,0,${level})`
    d.fillRect(0, 0, dimCanvas.width, dimCanvas.height)
    d.globalCompositeOperation = 'destination-out'
    d.fillStyle = '#000'
    for (const s of spots) {
      const r = s as Konva.Rect
      d.beginPath()
      d.roundRect(r.x(), r.y(), r.width() * r.scaleX(), r.height() * r.scaleY(), r.cornerRadius() as number)
      d.fill()
    }
    ;(ctx as unknown as { _context: CanvasRenderingContext2D })._context.drawImage(dimCanvas, 0, 0)
  }
})
// El oscurecido va entre la imagen y las anotaciones: las flechas y textos siguen viéndose bien
layer.add(dim)
layer.add(ann)
stage.add(layer)

const ui = new Konva.Layer()
stage.add(ui)
const tr = new Konva.Transformer({
  rotateEnabled: false,
  flipEnabled: false,
  ignoreStroke: true,
  borderStroke: '#5b7cfa',
  anchorStroke: '#5b7cfa',
  anchorFill: '#fff',
  anchorSize: 9,
  anchorCornerRadius: 5
})
const draft = new Konva.Rect({ stroke: '#fff', dash: [6, 4], strokeWidth: 1.5, strokeScaleEnabled: false, listening: false, visible: false, fill: 'rgba(91,124,250,0.12)' })
const cropRect = new Konva.Rect({ visible: false, draggable: true, stroke: '#fff', strokeWidth: 1.5, strokeScaleEnabled: false, fill: 'rgba(0,0,0,0.001)' })
const cropShade = new Konva.Shape({
  listening: false,
  visible: false,
  sceneFunc(ctx) {
    const c = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
    c.beginPath()
    c.rect(0, 0, base.width, base.height)
    c.rect(cropRect.x(), cropRect.y(), cropRect.width() * cropRect.scaleX(), cropRect.height() * cropRect.scaleY())
    c.fillStyle = 'rgba(0,0,0,0.55)'
    c.fill('evenodd')
  }
})
const cropTr = new Konva.Transformer({
  rotateEnabled: false,
  flipEnabled: false,
  ignoreStroke: true,
  keepRatio: false,
  borderStroke: '#fff',
  anchorStroke: '#fff',
  anchorFill: '#5b7cfa',
  anchorSize: 10
})
ui.add(cropShade, cropRect, cropTr, tr, draft)
// Cada vez que cambia la selección se actualizan los tiradores de flechas y líneas
const setTrNodes = tr.nodes.bind(tr)
;(tr as unknown as { nodes: (n?: Konva.Node[]) => unknown }).nodes = (n?: Konva.Node[]) => {
  if (n === undefined) return setTrNodes()
  const r = setTrNodes(n)
  queueMicrotask(syncHandles)
  return r
}

// ---------- Utilidades ----------

const pointer = () => ann.getRelativePointerPosition() ?? { x: 0, y: 0 }
const sw = () => SIZES[sizeIdx] * unit

function topAnnotation(node: Konva.Node | null): Konva.Node | null {
  let n: Konva.Node | null = node
  while (n && n.getParent() && n.getParent() !== ann) n = n.getParent()
  return n && n.getParent() === ann ? n : null
}

function shadow(strength = 1) {
  return { shadowColor: 'rgba(0,0,0,0.35)', shadowBlur: 5 * unit * strength, shadowOffsetY: 1.5 * unit * strength }
}

function toast(html: string, ms = 2200): void {
  const t = $('#toast')
  t.innerHTML = html
  t.hidden = false
  clearTimeout((t as unknown as { _timer?: number })._timer)
  ;(t as unknown as { _timer?: number })._timer = window.setTimeout(() => (t.hidden = true), ms)
}

const saveBg = () => storeBg(bg)
function savePresets(p: Background[]): void {
  if (!storePresets(p)) toast('No queda espacio para más favoritos (las imágenes de fondo ocupan mucho)')
}

let bgImg: HTMLImageElement | null = null
function loadBgImage(): void {
  bgImg = null
  if (bg.kind !== 'image' || !bg.image) return
  const i = new Image()
  i.onload = () => fit()
  i.src = bg.image
  bgImg = i
}

/** Parte de la captura que se usa con el fondo (sin márgenes uniformes si hay Auto Balance). */
let balanceCache: { src: HTMLCanvasElement; box: IRect } | null = null
function contentCrop(): IRect {
  const full = { x: 0, y: 0, width: base.width, height: base.height }
  if (!bg.enabled || !bg.balance) return full
  if (balanceCache?.src !== base) balanceCache = { src: base, box: contentBox(base) }
  return balanceCache.box
}

// ---------- Historial ----------

interface Snapshot {
  base: HTMLCanvasElement
  nodes: Konva.Node[]
}
const history: Snapshot[] = []
let hIndex = -1
/** Posición del historial en el último guardado (o al abrir la captura) */
let savedIndex = 0

const HISTORY_MAX_STEPS = 80
/** Memoria máxima de los lienzos base guardados para deshacer (cada recorte o giro guarda uno). */
const HISTORY_MAX_BYTES = 512 * 1024 * 1024

/** Bytes de los lienzos base distintos que guarda el historial (varios pasos comparten el mismo). */
function historyBytes(): number {
  const seen = new Set<HTMLCanvasElement>()
  let bytes = 0
  for (const s of history) {
    if (seen.has(s.base)) continue
    seen.add(s.base)
    bytes += s.base.width * s.base.height * 4
  }
  return bytes
}

function pushHistory(): void {
  history.splice(hIndex + 1)
  history.push({ base, nodes: ann.getChildren().map((n) => n.clone()) })
  // Se olvidan los pasos más antiguos; el actual se conserva siempre
  while (history.length > 1 && (history.length > HISTORY_MAX_STEPS || historyBytes() > HISTORY_MAX_BYTES)) {
    history.shift()
    savedIndex--
  }
  hIndex = history.length - 1
  updateUndoButtons()
}

function restore(s: Snapshot): void {
  tr.nodes([])
  ann.destroyChildren()
  for (const n of s.nodes) ann.add(n.clone())
  setBase(s.base)
  applyToolMode()
}

function undo(): void {
  if (hIndex <= 0) return
  hIndex--
  restore(history[hIndex])
  updateUndoButtons()
}

function redo(): void {
  if (hIndex >= history.length - 1) return
  hIndex++
  restore(history[hIndex])
  updateUndoButtons()
}

function updateUndoButtons(): void {
  $<HTMLButtonElement>('#undo').disabled = hIndex <= 0
  $<HTMLButtonElement>('#redo').disabled = hIndex >= history.length - 1
  // El proceso principal pregunta al cerrar si hay cambios sin guardar
  api.send('editor:dirty', hIndex !== savedIndex)
}

/** `snap`: paso que se guardó (si ya se olvidó del historial, queda como «sin guardar»). */
function markSaved(snap = history[hIndex]): void {
  savedIndex = history.indexOf(snap)
  updateUndoButtons()
}

// ---------- Lienzo y fondo ----------

function setBase(c: HTMLCanvasElement): void {
  const resized = c.width !== base.width || c.height !== base.height
  base = c
  baseNode.image(c)
  baseNode.size({ width: c.width, height: c.height })
  if (resized) fit()
  layer.batchDraw()
}

// ---------- Zoom ----------
// zoom = null → ajustar a la ventana; si no, factor respecto al tamaño real (1 = 100 %)
let zoom: number | null = null
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
const MIN_ZOOM = 0.1

function fitZoom(): number {
  const availW = Math.max(100, frameEl.clientWidth - 48)
  const availH = Math.max(100, frameEl.clientHeight - 48)
  const c = contentCrop()
  const L = bg.enabled ? bgLayout(c.width, c.height, bg, unit) : { W: base.width, H: base.height }
  return Math.min(1, (availW * unit) / L.W, (availH * unit) / L.H)
}

/** Límite para que el lienzo no pase de ~12 000 px de lado ni ~60 Mpx (memoria). */
function maxZoom(): number {
  const side = 12000 / Math.max(base.width, base.height)
  const area = Math.sqrt(60e6 / (base.width * base.height))
  return Math.max(1, Math.min(8, side, area))
}

function currentZoom(): number {
  return scale * unit
}

/** Cambia el zoom manteniendo fijo el punto de la pantalla (x, y) — por defecto, el centro del área visible. */
function setZoom(z: number | null, anchor?: { x: number; y: number }): void {
  const before = (stage.content as HTMLDivElement).getBoundingClientRect()
  const fr = frameEl.getBoundingClientRect()
  const ax = anchor?.x ?? fr.left + fr.width / 2
  const ay = anchor?.y ?? fr.top + fr.height / 2
  // Punto de la imagen bajo el ancla
  const px = (ax - before.left) / scale
  const py = (ay - before.top) / scale
  zoom = z === null ? null : Math.min(maxZoom(), Math.max(MIN_ZOOM, z))
  fit()
  const after = (stage.content as HTMLDivElement).getBoundingClientRect()
  frameEl.scrollLeft += after.left + px * scale - ax
  frameEl.scrollTop += after.top + py * scale - ay
}

function stepZoom(dir: 1 | -1, anchor?: { x: number; y: number }): void {
  const z = currentZoom()
  const next =
    dir > 0
      ? (ZOOM_PRESETS.find((p) => p > z + 0.001) ?? z * 1.25)
      : ([...ZOOM_PRESETS].reverse().find((p) => p < z - 0.001) ?? z / 1.25)
  setZoom(next, anchor)
}

function renderZoom(): void {
  const pct = Math.round(currentZoom() * 100)
  const sel = $<HTMLSelectElement>('#zoom-select')
  const opts = ZOOM_PRESETS.filter((p) => p <= maxZoom() + 0.001)
    .map((p) => `<option value="${p}">${Math.round(p * 100)} %</option>`)
    .join('')
  sel.innerHTML = `<option value="current" hidden>${pct} %</option>${opts}<option value="fit">Ajustar a la ventana</option>`
  sel.value = 'current'
  $('#zoom-fit').classList.toggle('active', zoom === null)
}

function fit(): void {
  scale = (zoom ?? fitZoom()) / unit
  stage.size({ width: Math.round(base.width * scale), height: Math.round(base.height * scale) })
  stage.scale({ x: scale, y: scale })

  const on = bg.enabled
  const konva = stage.content as HTMLDivElement
  frameEl.classList.toggle('with-bg', on)
  if (on) {
    const c = contentCrop()
    const L = bgLayout(c.width, c.height, bg, unit)
    Object.assign(decor.style, { position: 'relative', display: 'block', padding: '0', width: `${L.W * scale}px`, height: `${L.H * scale}px`, background: backgroundCss(bg) })
    Object.assign(stageEl.style, {
      position: 'absolute',
      left: `${L.x * scale}px`,
      top: `${L.y * scale}px`,
      width: `${c.width * scale}px`,
      height: `${c.height * scale}px`,
      borderRadius: `${bg.radius * unit * scale}px`,
      boxShadow: bg.shadow ? `0 ${12 * unit * scale}px ${36 * unit * scale}px rgba(0,0,0,0.35)` : ''
    })
    konva.style.transform = c.x || c.y ? `translate(${-c.x * scale}px, ${-c.y * scale}px)` : ''
    $('#dims').textContent = `${base.width} × ${base.height} px → con fondo ${L.W} × ${L.H} px`
  } else {
    Object.assign(decor.style, { position: '', display: '', padding: '0', width: '', height: '', background: 'none' })
    Object.assign(stageEl.style, { position: '', left: '', top: '', width: '', height: '', borderRadius: '0', boxShadow: '' })
    konva.style.transform = ''
    $('#dims').textContent = `${base.width} × ${base.height} px`
  }
  renderZoom()
  syncHandles()
}

$('#zoom-in').addEventListener('click', () => stepZoom(1))
$('#zoom-out').addEventListener('click', () => stepZoom(-1))
$('#zoom-fit').addEventListener('click', () => setZoom(null))
$('#zoom-100').addEventListener('click', () => setZoom(1))
$('#zoom-select').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value
  if (v === 'fit') setZoom(null)
  else if (v !== 'current') setZoom(Number(v))
})

// Ctrl + rueda: zoom centrado en el puntero (la rueda sola desplaza)
frameEl.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    if (busy) return
    const factor = Math.exp(-e.deltaY * 0.0015)
    setZoom(currentZoom() * factor, { x: e.clientX, y: e.clientY })
  },
  { passive: false }
)

// ---------- Efectos (pixelado / desenfoque) como objetos movibles ----------

function effectCanvas(kind: string, r: IRect): HTMLCanvasElement {
  return kind === 'blur' ? blur(base, r, 10 * unit) : pixelate(base, r, Math.round(9 * unit))
}

function createEffect(kind: 'pixelate' | 'blur', rect: IRect): void {
  const r = clampRect(rect, base.width, base.height)
  if (!r) return
  const node = new Konva.Image({ ...r, image: effectCanvas(kind, r), name: 'effect' })
  node.setAttr('effect', kind)
  ann.add(node)
  // Los efectos van debajo del resto de anotaciones para no tapar flechas ni textos
  node.moveToBottom()
}

function regenEffect(node: Konva.Image): void {
  const r = clampRect(
    { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY() },
    base.width,
    base.height
  )
  if (!r) {
    node.destroy()
    return
  }
  node.scale({ x: 1, y: 1 })
  node.setAttrs({ ...r, image: effectCanvas(node.getAttr('effect'), r) })
}

// ---------- Lupa ----------

function setMagnifier(node: Konva.Image, cx: number, cy: number, r: number): void {
  const z = Number(node.getAttr('zoom')) || magZoom
  const img = magnifierCanvas(base, cx, cy, Math.max(4 * unit, r), z, unit)
  node.setAttrs({ scaleX: 1, scaleY: 1, x: cx - img.width / 2, y: cy - img.height / 2, width: img.width, height: img.height, image: img })
}

function regenMagnifier(node: Konva.Image): void {
  const w = node.width() * node.scaleX()
  const h = node.height() * node.scaleY()
  setMagnifier(node, node.x() + w / 2, node.y() + h / 2, Math.min(w, h) / 2 - magPad(unit))
}

// ---------- Texto suelto: simple, con contorno o con sombra ----------

function styleText(t: Konva.Text, col: string, fs: number): void {
  const style = (t.getAttr('textStyle') as TextStyle) ?? 'plain'
  const base = { fill: col, fontSize: fs, strokeEnabled: false, shadowEnabled: true, fillAfterStrokeEnabled: false }
  if (style === 'outline') {
    t.setAttrs({ ...base, stroke: isLight(col) ? '#111' : '#fff', strokeWidth: fs * 0.16, strokeEnabled: true, fillAfterStrokeEnabled: true, lineJoin: 'round', shadowEnabled: false })
  } else if (style === 'shadow') {
    t.setAttrs({ ...base, shadowColor: 'rgba(0,0,0,0.75)', shadowBlur: fs * 0.4, shadowOffsetX: 0, shadowOffsetY: fs * 0.08 })
  } else {
    t.setAttrs({ ...base, ...shadow(0.8) })
  }
}

// ---------- Etiquetas de texto (con fondo o bocadillo) ----------

function styleLabel(l: Konva.Label, col: string, fs: number): void {
  const style = l.getAttr('style') as TextStyle
  l.getText().setAttrs({ fontSize: fs, fill: isLight(col) ? '#111' : '#fff', padding: fs * 0.45 })
  l.getTag().setAttrs({
    fill: col,
    cornerRadius: style === 'pill' ? fs * 1.2 : fs * 0.35,
    opacity: style === 'translucent' ? 0.72 : 1,
    pointerDirection: style === 'bubble' ? l.getAttr('dir') : 'none',
    pointerWidth: fs * 0.9,
    pointerHeight: fs * 0.75,
    lineJoin: 'round',
    ...shadow()
  })
}

function textNodeOf(n: Konva.Node): Konva.Text {
  return n.name() === 'label' ? (n as Konva.Label).getText() : (n as Konva.Text)
}

/** Color "principal" de un texto: el del texto (simple) o el del fondo (etiqueta). */
function textColorOf(n: Konva.Node): string {
  return n.name() === 'label' ? ((n as Konva.Label).getTag().fill() as string) : ((n as Konva.Text).fill() as string)
}

// ---------- Estilo de los elementos ----------

function styleNode(n: Konva.Node): void {
  const name = n.name()
  const s = sw()
  if (name === 'arrow') {
    // En la flecha, el "relleno" es la punta: hueca (solo borde) o rellena
    const mode = paintMode.arrow
    const a = n as Konva.Arrow
    const st = (a.getAttr('arrowStyle') as ArrowStyle) ?? arrowStyle
    const w = s * ({ standard: 1, thin: 0.6, bold: 1.7, double: 1 } as const)[st]
    const head = Math.max(10 * unit, w * (st === 'thin' ? 4.2 : 3.2))
    a.setAttrs({
      stroke: color,
      fill: fillColor,
      fillEnabled: mode !== 'stroke',
      strokeWidth: w,
      pointerLength: head,
      pointerWidth: head * (st === 'thin' ? 0.8 : 1),
      pointerAtBeginning: st === 'double',
      paint: mode,
      arrowStyle: st
    })
  } else if (name === 'rect' || name === 'ellipse') {
    const mode = paintMode[name]
    ;(n as Konva.Shape).setAttrs({
      stroke: color,
      fill: fillColor,
      strokeWidth: s,
      strokeEnabled: mode !== 'fill',
      fillEnabled: mode !== 'stroke',
      paint: mode
    })
  } else if (name === 'line' || name === 'pen') {
    ;(n as Konva.Shape).setAttrs({ stroke: color, strokeWidth: s })
  } else if (name === 'highlighter') {
    const smart = Number(n.getAttr('smartWidth'))
    ;(n as Konva.Shape).setAttrs({ stroke: color, strokeWidth: smart || s * 4.5 })
  } else if (name === 'text') {
    styleText(n as Konva.Text, color, FONT_SIZES[sizeIdx] * unit)
  } else if (name === 'label') {
    styleLabel(n as Konva.Label, color, FONT_SIZES[sizeIdx] * unit)
  } else if (name === 'counter') {
    const g = n as Konva.Group
    const r = COUNTER_R[sizeIdx] * unit
    const circle = g.findOne<Konva.Circle>('Circle')
    const text = g.findOne<Konva.Text>('Text')
    circle?.setAttrs({ fill: color, radius: r })
    text?.setAttrs({ fill: isLight(color) ? '#111' : '#fff', fontSize: r * 1.15, width: r * 2, height: r * 2, x: -r, y: -r })
  }
}

// ---------- Creación de elementos ----------

interface Drawing {
  tool: Tool
  start: { x: number; y: number }
  node?: Konva.Shape
}
let drawing: Drawing | null = null
let erasing = false
let erasedAny = false
let cropping = false
let cropRatio: CropRatio = 'free'
const ratioValue = () => cropRatioValue(cropRatio, base.width, base.height)

function cropBox(start: { x: number; y: number }, p: { x: number; y: number }, alt: boolean) {
  let x1 = p.x
  let y1 = p.y
  const R = ratioValue()
  if (R) {
    const w = Math.abs(x1 - start.x)
    const h = Math.abs(y1 - start.y)
    if (w / Math.max(1, h) > R) y1 = start.y + Math.sign(y1 - start.y || 1) * (w / R)
    else x1 = start.x + Math.sign(x1 - start.x || 1) * (h * R)
  } else if (!alt) {
    // Ajuste a bordes (Alt lo desactiva)
    const e = edgeProfiles(base)
    const tol = Math.max(4, 10 / scale)
    x1 = snapTo(x1, e.col, tol)
    y1 = snapTo(y1, e.row, tol)
  }
  return { x: Math.min(start.x, x1), y: Math.min(start.y, y1), width: Math.abs(x1 - start.x), height: Math.abs(y1 - start.y) }
}

function applyCropRatio(): void {
  const R = ratioValue()
  cropTr.keepRatio(!!R)
  cropTr.enabledAnchors(R ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'])
  if (R && cropTr.nodes().length) {
    const w = cropRect.width() * cropRect.scaleX()
    cropRect.setAttrs({ scaleX: 1, scaleY: 1, width: w, height: w / R })
    cropTr.forceUpdate()
  }
}

function lineProps(name: string) {
  return { name, lineCap: 'round' as const, lineJoin: 'round' as const, hitStrokeWidth: Math.max(14 * unit, sw() * 2) }
}

function startShape(p: { x: number; y: number }): void {
  const s = sw()
  let node: Konva.Shape | undefined
  switch (tool) {
    case 'arrow':
      node = new MiraArrow({ points: [p.x, p.y, p.x, p.y, p.x, p.y], ...lineProps('arrow'), ...shadow(), arrowStyle })
      break
    case 'line':
      node = new Konva.Line({ points: [p.x, p.y, p.x, p.y, p.x, p.y], ...lineProps('line'), ...shadow() })
      break
    case 'pen':
      node = new Konva.Line({ points: [p.x, p.y, p.x + 0.01, p.y], ...lineProps('pen'), ...shadow(0.6) })
      break
    case 'highlighter': {
      // Si hay una línea de texto bajo el cursor, el trazo toma su altura y va recto por ella
      smartBand = textBandAt(base, p.x, p.y)
      const cy = smartBand ? (smartBand.top + smartBand.bottom) / 2 : p.y
      node = new Konva.Line({ points: [p.x, cy, p.x + 0.01, cy], ...lineProps('highlighter'), opacity: 0.85, globalCompositeOperation: 'multiply' })
      if (smartBand) node.setAttrs({ smartWidth: (smartBand.bottom - smartBand.top + 1) * 1.25, lineCap: 'butt' })
      break
    }
    case 'rect':
      node = new Konva.Rect({ x: p.x, y: p.y, width: 0, height: 0, name: 'rect', cornerRadius: s, ...shadow() })
      break
    case 'ellipse':
      node = new Konva.Ellipse({ x: p.x, y: p.y, radiusX: 0, radiusY: 0, name: 'ellipse', ...shadow() })
      break
    case 'spotlight':
      node = new Konva.Rect({ x: p.x, y: p.y, width: 0, height: 0, name: 'spotlight', fill: 'rgba(0,0,0,0)', cornerRadius: 10 * unit })
      node.setAttr('dim', spotDim)
      break
    case 'magnifier': {
      const m = new Konva.Image({ name: 'magnifier', image: undefined })
      m.setAttr('zoom', magZoom)
      setMagnifier(m, p.x, p.y, 1)
      node = m
      break
    }
  }
  if (node) {
    styleNode(node)
    ann.add(node)
  }
  drawing = { tool, start: p, node }
  if (tool === 'pixelate' || tool === 'blur' || tool === 'remove') draft.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, visible: true })
  if (tool === 'crop') {
    cropping = true
    cropTr.nodes([])
    cropRect.setAttrs({ x: p.x, y: p.y, width: 0, height: 0, scaleX: 1, scaleY: 1, visible: true })
    cropShade.visible(true)
  }
}

function updateShape(p: { x: number; y: number }, shift: boolean, altKey = false): void {
  if (!drawing) return
  const { start, node } = drawing
  const box = (q: { x: number; y: number }) => ({
    x: Math.min(start.x, q.x),
    y: Math.min(start.y, q.y),
    width: Math.abs(q.x - start.x),
    height: Math.abs(q.y - start.y)
  })
  switch (drawing.tool) {
    case 'arrow':
    case 'line': {
      const q = constrain(start, p, shift, 'angle')
      ;(node as Konva.Line).points([start.x, start.y, (start.x + q.x) / 2, (start.y + q.y) / 2, q.x, q.y])
      break
    }
    case 'pen':
      ;(node as Konva.Line).points([...(node as Konva.Line).points(), p.x, p.y])
      break
    case 'highlighter': {
      const line = node as Konva.Line
      if (smartBand) {
        const cy = (smartBand.top + smartBand.bottom) / 2
        line.points([start.x, cy, p.x, cy])
      } else if (shift) line.points([start.x, start.y, p.x, start.y])
      else line.points([...line.points(), p.x, p.y])
      break
    }
    case 'rect':
    case 'spotlight':
      node!.setAttrs(box(constrain(start, p, shift, 'box')))
      break
    case 'magnifier':
      setMagnifier(node as Konva.Image, start.x, start.y, Math.hypot(p.x - start.x, p.y - start.y))
      break
    case 'ellipse': {
      const b = box(constrain(start, p, shift, 'box'))
      node!.setAttrs({ x: b.x + b.width / 2, y: b.y + b.height / 2, radiusX: b.width / 2, radiusY: b.height / 2 })
      break
    }
    case 'pixelate':
    case 'blur':
    case 'remove':
      draft.setAttrs(box(p))
      break
    case 'crop':
      cropRect.setAttrs(cropBox(start, p, altKey))
      break
  }
}

function finishShape(): void {
  if (!drawing) return
  const d = drawing
  drawing = null
  const tooSmall = (w: number, h: number) => w < 3 * unit && h < 3 * unit

  if (d.tool === 'pixelate' || d.tool === 'blur' || d.tool === 'remove') {
    draft.visible(false)
    const r = { x: draft.x(), y: draft.y(), width: draft.width(), height: draft.height() }
    if (tooSmall(r.width, r.height)) return
    if (d.tool === 'remove') {
      void removeObject(r)
      return
    }
    createEffect(d.tool, r)
    pushHistory()
    return
  }

  if (d.tool === 'crop') {
    if (tooSmall(cropRect.width(), cropRect.height())) return cancelCrop()
    cropTr.nodes([cropRect])
    applyCropRatio()
    showCropBar()
    return
  }

  const n = d.node
  if (!n) return
  if (d.tool === 'magnifier' && n.width() < 24 * unit) {
    n.destroy()
    return
  }
  const rect = n.getClientRect({ skipShadow: true, skipStroke: true, relativeTo: ann })
  const isLine = d.tool === 'arrow' || d.tool === 'line'
  const len = isLine ? Math.hypot(rect.width, rect.height) : Math.max(rect.width, rect.height)
  if (len < 4 * unit && d.tool !== 'pen' && d.tool !== 'highlighter') {
    n.destroy()
    return
  }
  if (d.tool === 'pen') smoothStroke(n as Konva.Line)
  pushHistory()
  // Flechas y líneas quedan seleccionadas con sus tiradores para poder curvarlas al momento
  if (isLine) select([n])
}

function smoothStroke(l: Konva.Line): void {
  const pts = l.points()
  if (pts.length < 8) return
  l.setAttrs({ points: simplify(pts, 1.6 * unit), tension: 0.4 })
}

let smartBand: { top: number; bottom: number } | null = null

function createText(p: { x: number; y: number }, initial = ''): void {
  if (!PLAIN_STYLES.includes(textStyle)) {
    createLabel(p, initial)
    return
  }
  const t = new Konva.Text({
    x: p.x,
    y: p.y - (FONT_SIZES[sizeIdx] * unit) / 2,
    text: initial,
    name: 'text',
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    fontStyle: 'bold',
    lineHeight: 1.2,
    textStyle
  })
  styleNode(t)
  ann.add(t)
  editText(t, true)
}

/** Etiqueta con fondo o bocadillo. En el bocadillo, (x, y) es la punta de la colita. */
function createLabel(p: { x: number; y: number }, initial = '', col = color, fs = FONT_SIZES[sizeIdx] * unit, style: TextStyle = textStyle, dir: BubbleDir = bubbleDir): Konva.Label {
  const l = new Konva.Label({ x: p.x, y: style === 'bubble' ? p.y : p.y - fs * 0.8, name: 'label' })
  l.setAttrs({ style, dir })
  l.add(new Konva.Tag({}))
  l.add(new Konva.Text({ text: initial, fontFamily: 'Segoe UI, system-ui, sans-serif', fontStyle: 'bold', lineHeight: 1.2 }))
  styleLabel(l, col, fs)
  ann.add(l)
  if (!initial) editText(l, true)
  return l
}

/** Cambia el estilo de un texto ya creado (simple ↔ con fondo ↔ bocadillo). */
function convertText(n: Konva.Node, style: TextStyle, dir: BubbleDir): Konva.Node {
  const tn = textNodeOf(n)
  const col = textColorOf(n)
  const fs = tn.fontSize() * n.scaleY()
  const r = n.getClientRect({ relativeTo: ann, skipShadow: true })
  const idx = n.zIndex()
  let out: Konva.Node
  if (PLAIN_STYLES.includes(style)) {
    const txt = new Konva.Text({ x: r.x, y: r.y, text: tn.text(), name: 'text', fontFamily: 'Segoe UI, system-ui, sans-serif', fontStyle: 'bold', lineHeight: 1.2, textStyle: style })
    styleText(txt, col, fs)
    ann.add(txt)
    out = txt
  } else {
    // El bocadillo apunta al centro inferior de donde estaba el texto
    const tip = style === 'bubble' ? { x: r.x + r.width / 2, y: r.y + r.height + fs * 0.9 } : { x: r.x, y: r.y + fs * 0.8 }
    out = createLabel(tip, tn.text(), col, fs, style, dir)
  }
  out.zIndex(Math.min(idx, ann.getChildren().length - 1))
  n.destroy()
  return out
}

function nextCounter(): number {
  let max = 0
  for (const n of ann.getChildren()) if (n.name() === 'counter') max = Math.max(max, Number((n as Konva.Group).getAttr('num')) || 0)
  return max + 1
}

function createCounter(p: { x: number; y: number }): void {
  const num = nextCounter()
  const g = new Konva.Group({ x: p.x, y: p.y, name: 'counter' })
  g.setAttr('num', num)
  g.add(new Konva.Circle({ radius: 10, stroke: '#fff', strokeWidth: 2 * unit, ...shadow(1.2) }))
  g.add(new Konva.Text({ text: String(num), fontStyle: 'bold', fontFamily: 'Segoe UI, system-ui, sans-serif', align: 'center', verticalAlign: 'middle', listening: false }))
  styleNode(g)
  ann.add(g)
  pushHistory()
}

// ---------- Quitar objeto ----------

const MAX_TEXTURE_AREA = 600 * 600

async function removeObject(rect: IRect): Promise<void> {
  const r = clampRect(rect, base.width, base.height)
  if (!r) return
  if (removeMode === 'solid') {
    setBase(fillSolid(base, r, solidColor))
    pushHistory()
    return
  }
  // Inicialización (y plan B): interpolación desde los bordes
  const simple = removeArea(base, r)
  if (r.width * r.height > MAX_TEXTURE_AREA) {
    setBase(simple)
    pushHistory()
    toast('La zona es muy grande: se ha usado un relleno simple')
    return
  }

  busy = true
  busyText = 'Quitando objeto…'
  draft.setAttrs({ ...r, visible: true })
  stageEl.style.cursor = 'progress'
  renderCtxBar()
  const src = base
  try {
    // Zona de trabajo: el hueco y su entorno, de donde se copian los parches
    const m = Math.max(64, Math.max(r.width, r.height))
    const z = clampRect({ x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m }, src.width, src.height)!
    const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(z.x, z.y, z.width, z.height).data
    const init = simple.getContext('2d', { willReadFrequently: true })!.getImageData(z.x, z.y, z.width, z.height).data
    const mask = new Uint8Array(z.width * z.height)
    for (let y = r.y; y < r.y + r.height; y++) {
      const start = (y - z.y) * z.width + (r.x - z.x)
      mask.fill(1, start, start + r.width)
    }
    const res = await runInpaint({ width: z.width, height: z.height, data, init, mask })
    const out = canvasOf(src.width, src.height)
    const ctx = out.getContext('2d')!
    ctx.drawImage(src, 0, 0)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(res.data), z.width, z.height), z.x, z.y)
    setBase(out)
  } catch (err) {
    console.error('Fallo del relleno por textura', err)
    setBase(simple)
  } finally {
    busy = false
    draft.visible(false)
    pushHistory()
    applyToolMode()
  }
}

// ---------- Edición de texto ----------

const ta = $<HTMLTextAreaElement>('#text-editor')
let editing: { node: Konva.Node; text: Konva.Text; isNew: boolean; before: string } | null = null

function editText(node: Konva.Node, isNew = false): void {
  commitText()
  const text = textNodeOf(node)
  editing = { node, text, isNew, before: text.text() }
  tr.nodes([])
  const isLabel = node.name() === 'label'
  const rect = (stage.content as HTMLDivElement).getBoundingClientRect()
  const abs = text.getAbsolutePosition()
  const k = text.getAbsoluteScale().y
  const fs = text.fontSize() * k
  const pad = isLabel ? text.padding() * k : 0
  node.hide()
  Object.assign(ta.style, {
    left: `${rect.left + abs.x}px`,
    top: `${rect.top + abs.y}px`,
    fontSize: `${fs}px`,
    padding: `${pad}px`,
    background: isLabel ? ((node as Konva.Label).getTag().fill() as string) : 'transparent',
    borderRadius: isLabel ? `${fs * 0.35}px` : '0',
    color: text.fill() as string,
    minWidth: `${fs * 2}px`,
    height: `${fs * 1.3}px`,
    width: `${fs * 2}px`
  })
  ta.value = text.text()
  ta.hidden = false
  autosize()
  setTimeout(() => {
    ta.focus()
    ta.select()
  })
}

function autosize(): void {
  ta.style.width = '0px'
  ta.style.height = '0px'
  ta.style.width = `${ta.scrollWidth + 4}px`
  ta.style.height = `${ta.scrollHeight}px`
}

function commitText(): void {
  if (!editing) return
  const { node, text, isNew, before } = editing
  editing = null
  ta.hidden = true
  const value = ta.value.replace(/\s+$/, '')
  if (!value) {
    node.destroy()
    if (!isNew) pushHistory()
    return
  }
  text.text(value)
  node.show()
  if (isNew || value !== before) pushHistory()
}

ta.addEventListener('input', autosize)
ta.addEventListener('blur', commitText)
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault()
    ta.blur()
  }
  e.stopPropagation()
})

// ---------- Tiradores de flechas y líneas (extremos + centro para curvar) ----------

const isBendable = (n: Konva.Node) => n.name() === 'arrow' || n.name() === 'line'

/** Puntos absolutos (inicio, centro, final). Las líneas antiguas de 2 puntos se convierten. */
function bendPoints(l: Konva.Line): number[] {
  normalizeLine(l)
  const p = l.points()
  if (p.length === 4) return [p[0], p[1], (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, p[2], p[3]]
  return p.slice(0, 6)
}

/** Integra la posición del nodo (si se arrastró entero) en los puntos. */
function normalizeLine(l: Konva.Line): void {
  if (l.x() === 0 && l.y() === 0) return
  const dx = l.x()
  const dy = l.y()
  l.setAttrs({ x: 0, y: 0, points: l.points().map((v, i) => v + (i % 2 ? dy : dx)) })
}

/** Curva solo si el punto central se aparta de la recta entre los extremos. */
function setBend(l: Konva.Line, pts: number[]): void {
  const [x0, y0, cx, cy, x1, y1] = pts
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const dist = Math.abs((x1 - x0) * (y0 - cy) - (x0 - cx) * (y1 - y0)) / len
  l.setAttrs({ points: pts, tension: dist > 2 * unit ? 0.5 : 0 })
}

const handles = [0, 1, 2].map((i) => {
  const h = new Konva.Circle({
    radius: 6,
    fill: i === 1 ? '#5b7cfa' : '#fff',
    stroke: i === 1 ? '#fff' : '#5b7cfa',
    strokeWidth: 2,
    strokeScaleEnabled: false,
    draggable: true,
    visible: false,
    name: 'bend-handle'
  })
  h.on('mouseenter', () => (stageEl.style.cursor = 'grab'))
  h.on('mouseleave', () => applyCursor())
  h.on('dragmove', () => {
    const l = tr.nodes()[0] as Konva.Line | undefined
    if (!l || !isBendable(l)) return
    const pts = bendPoints(l)
    // Al mover un extremo con la flecha recta, el centro le acompaña
    const straight = !(l.tension() > 0)
    pts[i * 2] = h.x()
    pts[i * 2 + 1] = h.y()
    if (straight && i !== 1) {
      pts[2] = (pts[0] + pts[4]) / 2
      pts[3] = (pts[1] + pts[5]) / 2
    }
    setBend(l, pts)
    syncHandles()
  })
  h.on('dragend', () => pushHistory())
  ui.add(h)
  return h
})

/** Muestra los tiradores si hay una sola flecha/línea seleccionada. */
function syncHandles(): void {
  const sel = tr.nodes()
  const l = sel.length === 1 && isBendable(sel[0]) ? (sel[0] as Konva.Line) : null
  const r = 6 / (stage.scaleX() || 1)
  if (!l) {
    for (const h of handles) if (h.visible()) h.visible(false)
    return
  }
  const pts = bendPoints(l)
  handles.forEach((h, i) => {
    if (h.isDragging()) return
    h.setAttrs({ x: pts[i * 2], y: pts[i * 2 + 1], radius: i === 1 ? r * 0.9 : r, visible: true })
  })
}

// ---------- Selección ----------

function select(nodes: Konva.Node[]): void {
  tr.nodes(nodes)
  const resizable = nodes.length > 0 && nodes.every((n) => RESIZABLE.includes(n.name()))
  const hasText = nodes.some((n) => TEXTUAL.includes(n.name()) || n.name() === 'magnifier')
  tr.resizeEnabled(resizable)
  tr.keepRatio(hasText)
  const bend = nodes.length === 1 && isBendable(nodes[0])
  tr.borderEnabled(!bend)
  if (nodes.length === 1 && nodes[0].name() === 'arrow') arrowStyle = (nodes[0].getAttr('arrowStyle') as ArrowStyle) ?? arrowStyle
  syncHandles()
  tr.enabledAnchors(
    hasText
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right']
  )
  // Al seleccionar una forma, la barra muestra su estilo actual
  if (nodes.length === 1 && FILLABLE.includes(nodes[0].name() as Fillable)) {
    const n = nodes[0] as Konva.Shape
    const kind = n.name() as Fillable
    color = (n.stroke() as string) || color
    fillColor = (n.fill() as string) || fillColor
    fillLinked = fillColor === color
    paintMode[kind] = (n.getAttr('paint') as PaintMode) ?? paintMode[kind]
    renderSwatches()
  }
  // Textos: la barra refleja su estilo
  if (nodes.length === 1 && TEXTUAL.includes(nodes[0].name())) {
    const n = nodes[0]
    textStyle = n.name() === 'label' ? (n.getAttr('style') as TextStyle) : ((n.getAttr('textStyle') as TextStyle) ?? 'plain')
    if (n.name() === 'label') bubbleDir = n.getAttr('dir') as BubbleDir
    color = textColorOf(n)
    renderSwatches()
  }
  if (nodes.length === 1 && nodes[0].name() === 'spotlight') spotDim = Number(nodes[0].getAttr('dim')) || spotDim
  if (nodes.length === 1 && nodes[0].name() === 'magnifier') magZoom = Number(nodes[0].getAttr('zoom')) || magZoom
  renderCtxBar()
}

function deleteSelected(): void {
  const nodes = tr.nodes()
  if (!nodes.length) return
  tr.nodes([])
  for (const n of nodes) n.destroy()
  pushHistory()
  renderCtxBar()
}

// ---------- Barra contextual (estilo de la forma, recorte o ayuda) ----------

/** Forma cuyo borde/relleno se está editando: la selección o, si no hay, la herramienta activa. */
function styleKind(): Fillable | null {
  const sel = tr.nodes()
  if (sel.length) {
    const name = sel[0].name()
    return sel.every((n) => n.name() === name) && FILLABLE.includes(name as Fillable) ? (name as Fillable) : null
  }
  return FILLABLE.includes(tool as Fillable) ? (tool as Fillable) : null
}

/** Pinta la barra contextual según lo que se esté haciendo: recorte, tarea en curso, herramienta o selección. */
function renderCtxBar(): void {
  $('#ctxbar').innerHTML = ctxBarHtml()
}

function ctxBarHtml(): string {
  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? ''
  const sel = tr.nodes()
  const single = sel.length === 1 ? sel[0].name() : null
  const toolOrSelected = (t: Tool) => (tool === t && !sel.length) || single === t

  if (cropTr.nodes().length) return cropActiveHtml(cropRatio)
  if (tool === 'crop') return cropToolHtml(cropRatio, hint)
  if (busy) return busyHtml(busyText)
  if (tool === 'remove' && !sel.length) return removeHtml(hint, removeMode, solidColor)
  if ((tool === 'text' && !sel.length) || (single && TEXTUAL.includes(single))) return textHtml(sel.length ? 'Doble clic para editar el texto' : hint, textStyle, bubbleDir)
  if (toolOrSelected('spotlight')) return spotlightHtml(hint, spotDim)
  if (toolOrSelected('magnifier')) return magnifierHtml(hint, magZoom)
  const kind = styleKind()
  if (!kind) return hintHtml(hint)
  const mode = paintMode[kind]
  // Si el modo deja una de las dos opciones sin sentido, la paleta pasa a la otra
  colorTarget = effectiveColorTarget(mode, colorTarget)
  return shapeHtml({ kind, mode, colorTarget, color, fillColor, arrowStyle })
}

$('#ctxbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
  if (!b || b.disabled) return
  if (b.dataset.cratio) {
    cropRatio = b.dataset.cratio as CropRatio
    applyCropRatio()
    renderCtxBar()
  } else if (b.id === 'crop-apply') applyCrop()
  else if (b.id === 'crop-cancel') cancelCrop()
  else if (b.dataset.paint) {
    const kind = styleKind()
    if (!kind) return
    const m = b.dataset.paint as PaintMode
    paintMode[kind] = m
    // Al activar el relleno, la paleta pasa a colorear el relleno
    colorTarget = m === 'stroke' ? 'stroke' : 'fill'
    renderCtxBar()
    renderSwatches()
    restyleSelection()
  } else if (b.dataset.remove) {
    removeMode = b.dataset.remove as 'texture' | 'solid'
    renderCtxBar()
    renderSwatches()
  } else if ('solidAuto' in b.dataset) {
    solidColor = null
    renderCtxBar()
    renderSwatches()
  } else if (b.dataset.target) {
    colorTarget = b.dataset.target as 'stroke' | 'fill'
    renderCtxBar()
    renderSwatches()
  } else if (b.dataset.astyle) {
    arrowStyle = b.dataset.astyle as ArrowStyle
    for (const n of tr.nodes()) if (n.name() === 'arrow') n.setAttr('arrowStyle', arrowStyle)
    renderCtxBar()
    restyleSelection()
  } else if (b.dataset.tstyle || b.dataset.dir) {
    if (b.dataset.tstyle) textStyle = b.dataset.tstyle as TextStyle
    if (b.dataset.dir) bubbleDir = b.dataset.dir as BubbleDir
    const sel = tr.nodes()
    if (sel.length === 1 && TEXTUAL.includes(sel[0].name())) {
      const out = convertText(sel[0], textStyle, bubbleDir)
      applyToolMode()
      select([out])
      pushHistory()
    } else renderCtxBar()
  } else if (b.dataset.zoom) {
    magZoom = Number(b.dataset.zoom)
    const sel = tr.nodes().filter((n) => n.name() === 'magnifier')
    for (const n of sel) {
      n.setAttr('zoom', magZoom)
      regenMagnifier(n as Konva.Image)
    }
    if (sel.length) pushHistory()
    renderCtxBar()
  }
})

$('#ctxbar').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement
  if (el.id !== 'spot-dim') return
  spotDim = Number(el.value) / 100
  for (const n of ann.getChildren((x) => x.name() === 'spotlight')) (n as Konva.Node).setAttr('dim', spotDim)
  layer.batchDraw()
})
$('#ctxbar').addEventListener('change', (e) => {
  if ((e.target as HTMLElement).id === 'spot-dim' && ann.getChildren((x) => x.name() === 'spotlight').length) pushHistory()
})

function bake(n: Konva.Node): void {
  const sx = n.scaleX()
  const sy = n.scaleY()
  if (sx === 1 && sy === 1) return
  const name = n.name()
  if (name === 'rect' || name === 'spotlight') {
    n.setAttrs({ width: n.width() * sx, height: n.height() * sy, scaleX: 1, scaleY: 1 })
  } else if (name === 'magnifier') {
    regenMagnifier(n as Konva.Image)
  } else if (name === 'label') {
    const l = n as Konva.Label
    l.scale({ x: 1, y: 1 })
    styleLabel(l, textColorOf(l), l.getText().fontSize() * sy)
  } else if (name === 'ellipse') {
    const e = n as Konva.Ellipse
    e.setAttrs({ radiusX: e.radiusX() * sx, radiusY: e.radiusY() * sy, scaleX: 1, scaleY: 1 })
  } else if (name === 'effect') {
    regenEffect(n as Konva.Image)
  } else if (name === 'text') {
    const t = n as Konva.Text
    t.setAttrs({ fontSize: t.fontSize() * sy, scaleX: 1, scaleY: 1 })
  }
}

tr.on('transformend', () => {
  for (const n of tr.nodes()) bake(n)
  pushHistory()
})

// ---------- Recorte ----------

function showCropBar(): void {
  renderCtxBar()
}

function cancelCrop(): void {
  cropping = false
  cropTr.nodes([])
  cropRect.visible(false)
  cropShade.visible(false)
  renderCtxBar()
}

function applyCrop(): void {
  const r = clampRect(
    { x: cropRect.x(), y: cropRect.y(), width: cropRect.width() * cropRect.scaleX(), height: cropRect.height() * cropRect.scaleY() },
    base.width,
    base.height
  )
  cancelCrop()
  if (!r) return
  for (const n of ann.getChildren()) n.position({ x: n.x() - r.x, y: n.y() - r.y })
  setBase(crop(base, r))
  for (const n of ann.getChildren()) if (n.name() === 'effect') regenEffect(n as Konva.Image)
  pushHistory()
}

// ---------- Goma ----------

function eraseAt(): void {
  const pos = stage.getPointerPosition()
  if (!pos) return
  const hit = topAnnotation(stage.getIntersection(pos))
  if (hit) {
    hit.destroy()
    erasedAny = true
  }
}

// ---------- Eventos del lienzo ----------

stage.on('pointerdown', (e) => {
  if (e.evt.button !== 0 || editing || busy) return
  if (e.target.getLayer() === ui) return // tiradores del transformador, de la flecha o del recorte
  // Empezar a dibujar deselecciona (y oculta los tiradores de la flecha anterior)
  if (tool !== 'select' && tr.nodes().length) select([])
  const p = pointer()
  switch (tool) {
    case 'select': {
      const n = topAnnotation(e.target)
      if (!n) return select([])
      if (e.evt.shiftKey) {
        const cur = tr.nodes()
        select(cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n])
      } else if (!tr.nodes().includes(n)) select([n])
      return
    }
    case 'erase':
      erasing = true
      erasedAny = false
      eraseAt()
      return
    case 'text': {
      const n = topAnnotation(e.target)
      if (n && TEXTUAL.includes(n.name())) editText(n)
      else createText(p)
      return
    }
    case 'counter':
      createCounter(p)
      return
    default:
      startShape(p)
  }
})

stage.on('pointermove', (e) => {
  if (erasing) eraseAt()
  else if (drawing) updateShape(pointer(), e.evt.shiftKey, e.evt.altKey)
})

window.addEventListener('pointerup', () => {
  if (erasing) {
    erasing = false
    if (erasedAny) pushHistory()
  }
  if (drawing) finishShape()
})

stage.on('dblclick dbltap', (e) => {
  const n = topAnnotation(e.target)
  if (n && TEXTUAL.includes(n.name())) editText(n)
})

stage.on('dragmove', () => syncHandles())

stage.on('dragend', (e) => {
  if (e.target === cropRect) return
  const n = topAnnotation(e.target)
  if (!n) return
  if (n.name() === 'effect') regenEffect(n as Konva.Image)
  if (n.name() === 'magnifier') regenMagnifier(n as Konva.Image)
  pushHistory()
})

// ---------- Barra de herramientas ----------

function eraserCursor(): string {
  const svgC = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='9' fill='rgba(255,255,255,0.25)' stroke='white' stroke-width='2'/><circle cx='12' cy='12' r='9' fill='none' stroke='black' stroke-width='0.7'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svgC)}") 12 12, crosshair`
}

function applyCursor(): void {
  stageEl.style.cursor =
    tool === 'select' ? 'default' : tool === 'text' ? 'text' : tool === 'erase' ? eraserCursor() : 'crosshair'
}

function applyToolMode(): void {
  const isSelect = tool === 'select'
  for (const n of ann.getChildren()) n.draggable(isSelect)
  if (!isSelect) tr.nodes([])
  if (tool !== 'crop') cancelCrop()
  applyCursor()
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]'))
    b.classList.toggle('active', b.dataset.tool === tool)
  renderCtxBar()
  renderSwatches()
}

function setTool(t: Tool): void {
  commitText()
  closeMenu()
  tool = t
  // Si la herramienta pertenece a un grupo, el botón del grupo pasa a mostrarla
  for (const g of TOOLBAR) if (typeof g !== 'string' && g.tools.includes(t) && groupLast[g.id] !== t) {
    groupLast[g.id] = t
    renderTools()
  }
  applyToolMode()
}

function renderTools(): void {
  $('#tools').innerHTML = TOOLBAR.map((item) => {
    if (typeof item === 'string') {
      const d = toolDef(item)
      return `<button class="icon-btn" data-tool="${d.id}" title="${d.label} (${d.key.toUpperCase()})">${icons[d.icon]}</button>`
    }
    const d = toolDef(groupLast[item.id])
    return `<div class="tgroup"><button class="icon-btn" data-tool="${d.id}" title="${d.label} (${d.key.toUpperCase()}) · grupo ${item.label}">${icons[d.icon]}</button><button class="caret" data-open="${item.id}" title="${item.label}: ver todas">${icons.chevronDown}</button></div>`
  }).join('')
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === tool)
}

// ---------- Menú desplegable (grupos de herramientas y menú Imagen) ----------

interface MenuItem {
  icon?: IconName
  label: string
  key?: string
  active?: boolean
  action: () => void
}
const menu = $('#menu')

function openMenu(anchor: HTMLElement, items: Array<MenuItem | 'sep'>): void {
  menu.innerHTML = items
    .map((it, i) =>
      it === 'sep'
        ? '<div class="menu-sep"></div>'
        : `<button data-i="${i}" class="${it.active ? 'active' : ''}">${it.icon ? icons[it.icon] : '<span></span>'}<span class="ml">${it.label}</span><kbd>${it.key ?? ''}</kbd></button>`
    )
    .join('')
  menu.hidden = false
  const r = anchor.getBoundingClientRect()
  const w = menu.offsetWidth
  menu.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`
  menu.style.top = `${r.bottom + 6}px`
  menu.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-i]')
    if (!b) return
    const it = items[Number(b.dataset.i)] as MenuItem
    closeMenu()
    it.action()
  }
}

function closeMenu(): void {
  menu.hidden = true
}

window.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !(e.target as HTMLElement).closest('#menu, [data-open], #image-menu')) closeMenu()
})

function openGroupMenu(id: string, anchor: HTMLElement): void {
  const g = TOOLBAR.find((x) => typeof x !== 'string' && x.id === id) as ToolGroup
  const items: Array<MenuItem | 'sep'> = g.tools.map((tid) => {
    const d = toolDef(tid)
    return { icon: d.icon, label: d.label, key: d.key.toUpperCase(), active: tool === tid, action: () => setTool(tid) }
  })
  if (id === 'hide') items.push('sep', { icon: 'censor', label: 'Censura automática de datos personales', action: () => void autoCensor() })
  openMenu(anchor, items)
}

function openImageMenu(anchor: HTMLElement): void {
  openMenu(anchor, [
    { icon: 'rotateLeft', label: 'Rotar a la izquierda', action: () => applyTransform('rotL') },
    { icon: 'rotateRight', label: 'Rotar a la derecha', action: () => applyTransform('rotR') },
    { icon: 'flipH', label: 'Voltear en horizontal', action: () => applyTransform('flipH') },
    { icon: 'flipV', label: 'Voltear en vertical', action: () => applyTransform('flipV') },
    'sep',
    { icon: 'resize', label: 'Redimensionar…', action: () => openResize(anchor) },
    'sep',
    { icon: 'censor', label: 'Censura automática de datos personales', action: () => void autoCensor() },
    { icon: 'textScan', label: 'Copiar el texto de la imagen', action: () => void copyText() },
    { icon: 'pin', label: 'Anclar en la pantalla', action: () => void pinImage() }
  ])
}

function restyleSelection(): void {
  const nodes = tr.nodes()
  if (!nodes.length) return
  for (const n of nodes) if (n.name() !== 'effect') styleNode(n)
  tr.forceUpdate()
  pushHistory()
}

function buildToolbar(): void {
  renderTools()
  $('#tools').addEventListener('click', (e) => {
    const open = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-open]')
    if (open) {
      if (!menu.hidden) return closeMenu()
      return openGroupMenu(open.dataset.open!, open.parentElement as HTMLElement)
    }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]')
    if (!b) return
    // Clic en un grupo cuya herramienta ya está activa: se despliega el menú del grupo
    const group = b.parentElement?.classList.contains('tgroup') ? (b.parentElement.querySelector('[data-open]') as HTMLElement).dataset.open : null
    if (group && tool === b.dataset.tool && menu.hidden) return openGroupMenu(group, b.parentElement as HTMLElement)
    setTool(b.dataset.tool as Tool)
  })

  const colors = $('#colors')
  colors.innerHTML = COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')
  colors.insertAdjacentHTML(
    'beforeend',
    `<button class="swatch custom" id="custom-color" title="Más colores (HEX / RGB)"></button>
     <button class="icon-btn" id="eyedropper" title="Cuentagotas: coge un color de cualquier sitio de la pantalla (I)">${icons.eyedropper}</button>`
  )
  colors.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('#custom-color')) {
      openColorPicker(target.closest('#custom-color') as HTMLElement, currentPaletteColor() ?? color, (c, done) => applyColor(c, done), 'Color personalizado')
      return
    }
    if (target.closest('#eyedropper')) {
      void eyedrop()
      return
    }
    const b = target.closest<HTMLButtonElement>('[data-color]')
    if (b) applyColor(b.dataset.color!, true)
  })

  const sizes = $('#sizes')
  sizes.innerHTML = SIZES.map(
    (s, i) => `<button class="icon-btn size-btn" data-size="${i}" title="Grosor ${['fino', 'medio', 'grueso'][i]}"><span style="width:${s + 3}px;height:${s + 3}px"></span></button>`
  ).join('')
  sizes.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-size]')
    if (!b) return
    sizeIdx = Number(b.dataset.size)
    renderSwatches()
    restyleSelection()
  })

  $('#undo').innerHTML = icons.undo
  $('#redo').innerHTML = icons.redo
  $('#bg-toggle').innerHTML = icons.background
  $('#copy').innerHTML = icons.copy
  $('#save-as').innerHTML = icons.save
  $('#image-menu').innerHTML = icons.image + icons.chevronDown
  $('#ocr').innerHTML = icons.textScan
  $('#image-menu').addEventListener('click', (e) => (menu.hidden ? openImageMenu(e.currentTarget as HTMLElement) : closeMenu()))
  $('#ocr').addEventListener('click', () => void copyText())
  $('#undo').addEventListener('click', undo)
  $('#redo').addEventListener('click', redo)
  $('#copy').addEventListener('click', copy)
  $('#save').addEventListener('click', save)
  $('#save-as').addEventListener('click', saveAs)
  $('#bg-toggle').addEventListener('click', () => {
    bg.enabled = !bg.enabled
    saveBg()
    renderBgPanel()
    fit()
  })
  renderSwatches()
}

/** Color que está editando ahora la paleta (borde, relleno o color plano de "Quitar objeto"). */
function currentPaletteColor(): string | null {
  return tool === 'remove' && removeMode === 'solid' ? solidColor : styleKind() && colorTarget === 'fill' ? fillColor : color
}

/** Aplica un color al destino activo. `commit` = guardar en el historial (al terminar de elegir). */
function applyColor(c: string, commit: boolean): void {
  if (tool === 'remove' && removeMode === 'solid' && !tr.nodes().length) {
    solidColor = c
  } else if (styleKind() && colorTarget === 'fill') {
    fillColor = c
    fillLinked = false
  } else {
    color = c
    if (fillLinked) fillColor = c
  }
  renderSwatches()
  renderCtxBar()
  const nodes = tr.nodes()
  if (!nodes.length || (tool === 'remove' && removeMode === 'solid')) return
  for (const n of nodes) if (n.name() !== 'effect' && n.name() !== 'magnifier' && n.name() !== 'spotlight') styleNode(n)
  tr.forceUpdate()
  layer.batchDraw()
  if (commit) pushHistory()
}

/** Cuentagotas: elige un color de cualquier punto de la pantalla (también fuera del editor). */
async function eyedrop(): Promise<void> {
  closeColorPicker()
  const c = await pickScreenColor()
  if (!c) return
  applyColor(c, true)
  toast(`Color ${c.toUpperCase()} · RGB ${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)}`)
}

function renderSwatches(): void {
  const current =
    tool === 'remove' && removeMode === 'solid' ? solidColor : styleKind() && colorTarget === 'fill' ? fillColor : color
  for (const b of document.querySelectorAll<HTMLElement>('#colors [data-color]'))
    b.classList.toggle('active', b.dataset.color === current)
  // El botón de "más colores" muestra el color elegido cuando no es de la paleta
  const custom = document.querySelector<HTMLElement>('#custom-color')
  if (custom) {
    const own = !!current && !COLORS.includes(current)
    custom.classList.toggle('active', own)
    custom.style.setProperty('--c', own ? current! : 'transparent')
    custom.title = own ? `Color ${current!.toUpperCase()} · más colores (HEX / RGB)` : 'Más colores (HEX / RGB)'
  }
  for (const b of document.querySelectorAll<HTMLElement>('#sizes [data-size]'))
    b.classList.toggle('active', Number(b.dataset.size) === sizeIdx)
}

const ALIGNS: BgAlign[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']
const RATIOS: Array<[BgRatio, string]> = [
  ['auto', 'Libre'],
  ['1:1', '1:1'],
  ['4:3', '4:3'],
  ['16:9', '16:9'],
  ['9:16', '9:16']
]

function renderBgPanel(): void {
  $('#bgpanel').hidden = !bg.enabled
  $('#bg-toggle').classList.toggle('active', bg.enabled)
  const sameBg = (k: string, c: [string, string]) => bg.kind === k && c[0] === bg.colors[0] && c[1] === bg.colors[1]
  $('#gradients').innerHTML =
    BACKGROUNDS.map(
      (b, i) => `<button data-grad="${i}" class="${sameBg(b.kind, b.colors) ? 'active' : ''}" title="${b.kind === 'solid' ? 'Color liso' : 'Degradado'}" style="background:${backgroundCss({ ...bg, kind: b.kind, colors: b.colors })}"></button>`
    ).join('') +
    (bg.image ? `<button data-img class="${bg.kind === 'image' ? 'active' : ''}" title="Tu imagen" style="background:${backgroundCss({ ...bg, kind: 'image' })}"></button>` : '')
  $('#bg-ratio').innerHTML = RATIOS.map(([r, l]) => `<button data-ratio="${r}" class="${bg.ratio === r ? 'active' : ''}">${l}</button>`).join('')
  $('#bg-align').innerHTML = ALIGNS.map((a) => `<button data-align="${a}" class="${bg.align === a ? 'active' : ''}" title="Alinear"><i></i></button>`).join('')
  const solid = bg.kind === 'solid'
  $('#bg-c1').style.background = bg.colors[0]
  $('#bg-c1').title = `Color 1: ${bg.colors[0].toUpperCase()}`
  $('#bg-c2').style.background = bg.colors[1]
  $('#bg-c2').title = `Color 2: ${bg.colors[1].toUpperCase()}`
  $('#bg-c2').hidden = solid
  for (const b of document.querySelectorAll<HTMLElement>('#bg-kind [data-kind]')) b.classList.toggle('active', b.dataset.kind === (solid ? 'solid' : 'gradient'))
  $<HTMLInputElement>('#bg-pad').value = String(bg.padding)
  $<HTMLInputElement>('#bg-radius').value = String(bg.radius)
  $<HTMLInputElement>('#bg-shadow').checked = bg.shadow
  $<HTMLInputElement>('#bg-balance').checked = bg.balance
  const presets = loadPresets()
  $('#bg-presets').innerHTML = presets.length
    ? presets.map((p, i) => `<span class="preset" data-preset="${i}" title="Aplicar favorito" style="background:${backgroundCss(p)}"><b data-del="${i}" title="Quitar">×</b></span>`).join('')
    : '<span class="hint">Guarda aquí tus combinaciones preferidas</span>'
}

function bgChanged(): void {
  saveBg()
  renderBgPanel()
  fit()
}

$('#gradients').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-grad], [data-img]')
  if (!b) return
  if (b.dataset.grad !== undefined) {
    const c = BACKGROUNDS[Number(b.dataset.grad)]
    bg.kind = c.kind
    bg.colors = c.colors
  } else bg.kind = 'image'
  loadBgImage()
  bgChanged()
})
function pickBgColor(i: 0 | 1, anchor: HTMLElement): void {
  openColorPicker(
    anchor,
    bg.colors[i],
    (c, done) => {
      if (bg.kind === 'image') bg.kind = 'gradient'
      bg.colors = bg.kind === 'solid' ? [c, c] : i === 0 ? [c, bg.colors[1]] : [bg.colors[0], c]
      fit()
      if (done) {
        saveBg()
        renderBgPanel()
      }
    },
    bg.kind === 'solid' ? 'Color del fondo' : `Color ${i + 1} del degradado`
  )
}
$('#bg-c1').addEventListener('click', (e) => pickBgColor(0, e.currentTarget as HTMLElement))
$('#bg-c2').addEventListener('click', (e) => pickBgColor(1, e.currentTarget as HTMLElement))
$('#bg-kind').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')
  if (!b) return
  bg.kind = b.dataset.kind as 'gradient' | 'solid'
  if (bg.kind === 'solid') bg.colors = [bg.colors[0], bg.colors[0]]
  else if (bg.colors[0] === bg.colors[1]) bg.colors = [bg.colors[0], '#6d5cff']
  bgChanged()
})

$('#bg-image-btn').addEventListener('click', () => $<HTMLInputElement>('#bg-file').click())
$<HTMLInputElement>('#bg-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  // Se reduce (máx. 1600 px) para poder guardarla con el resto de ajustes
  const img = await createImageBitmap(file)
  const s = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = canvasOf(img.width * s, img.height * s)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  bg.image = c.toDataURL('image/jpeg', 0.85)
  bg.kind = 'image'
  ;(e.target as HTMLInputElement).value = ''
  loadBgImage()
  bgChanged()
})
$('#bg-ratio').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ratio]')
  if (!b) return
  bg.ratio = b.dataset.ratio as BgRatio
  bgChanged()
})
$('#bg-align').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-align]')
  if (!b) return
  bg.align = b.dataset.align as BgAlign
  bgChanged()
})
$('#bg-balance').addEventListener('change', (e) => {
  bg.balance = (e.target as HTMLInputElement).checked
  bgChanged()
})
$('#bg-save-preset').addEventListener('click', () => {
  const p = loadPresets()
  p.unshift({ ...bg, enabled: true })
  savePresets(p.slice(0, 8))
  renderBgPanel()
  toast('Fondo guardado en favoritos')
})
$('#bg-presets').addEventListener('click', (e) => {
  const el = e.target as HTMLElement
  const p = loadPresets()
  if (el.dataset.del !== undefined) {
    p.splice(Number(el.dataset.del), 1)
    savePresets(p)
    renderBgPanel()
    return
  }
  const chip = el.closest<HTMLElement>('[data-preset]')
  if (!chip) return
  Object.assign(bg, p[Number(chip.dataset.preset)], { enabled: true })
  loadBgImage()
  bgChanged()
})
$('#bg-pad').addEventListener('input', (e) => {
  bg.padding = Number((e.target as HTMLInputElement).value)
  saveBg()
  fit()
})
$('#bg-radius').addEventListener('input', (e) => {
  bg.radius = Number((e.target as HTMLInputElement).value)
  saveBg()
  fit()
})
$('#bg-shadow').addEventListener('change', (e) => {
  bg.shadow = (e.target as HTMLInputElement).checked
  saveBg()
  fit()
})

// ---------- Exportación ----------

/** Imagen con anotaciones, sin el fondo decorativo. */
function renderImage(): HTMLCanvasElement {
  commitText()
  const prevScale = stage.scaleX()
  const prevSize = stage.size()
  stage.scale({ x: 1, y: 1 })
  stage.size({ width: base.width, height: base.height })
  const out = layer.toCanvas({ x: 0, y: 0, width: base.width, height: base.height, pixelRatio: 1 })
  stage.scale({ x: prevScale, y: prevScale })
  stage.size(prevSize)
  return out
}

function render(): HTMLCanvasElement {
  return composeBackground(renderImage(), bg, unit, contentCrop(), bgImg)
}

async function copyText(): Promise<void> {
  api.send('editor:ocr-card', await canvasBytes(renderImage()))
}

async function pinImage(): Promise<void> {
  api.send('editor:pin', await canvasBytes(render()))
}

// ---------- Censura automática ----------

async function autoCensor(): Promise<void> {
  if (busy) return
  commitText()
  setTool('select')
  busy = true
  busyText = 'Buscando datos personales (correos, teléfonos, tarjetas, IBAN, DNI, IP)…'
  renderCtxBar()
  try {
    const res = await api.invoke('editor:ocr', await canvasBytes(base))
    if (!res.ok) {
      toast(res.error ?? 'No se pudo leer el texto de la imagen', 6000)
      return
    }
    const hits = findSensitive(res.lines, 3 * unit)
    if (!hits.length) {
      toast('No se han encontrado datos personales')
      return
    }
    for (const h of hits) createEffect('pixelate', h.rect)
    pushHistory()
    toast(`Ocultados: ${summarize(hits)} · <a id="undo-censor">Deshacer</a>`, 7000)
    $('#undo-censor').onclick = undo
  } finally {
    busy = false
    renderCtxBar()
  }
}

// ---------- Rotar, voltear y redimensionar ----------

function regenAll(): void {
  for (const n of ann.getChildren()) {
    if (n.name() === 'effect') regenEffect(n as Konva.Image)
    else if (n.name() === 'magnifier') regenMagnifier(n as Konva.Image)
  }
}

function applyTransform(op: Op): void {
  commitText()
  cancelCrop()
  tr.nodes([])
  const W = base.width
  const H = base.height
  transformNodes(ann.getChildren().slice(), op, W, H, ann)
  setBase(transformCanvas(base, op))
  regenAll()
  zoom = null
  fit()
  pushHistory()
  renderCtxBar()
}

const rs = {
  pop: $('#resize-pop'),
  w: $<HTMLInputElement>('#rs-w'),
  h: $<HTMLInputElement>('#rs-h'),
  lock: $<HTMLInputElement>('#rs-lock')
}

function openResize(anchor: HTMLElement): void {
  rs.w.value = String(base.width)
  rs.h.value = String(base.height)
  rs.pop.hidden = false
  const r = anchor.getBoundingClientRect()
  rs.pop.style.left = `${Math.min(r.left, window.innerWidth - rs.pop.offsetWidth - 12)}px`
  rs.pop.style.top = `${r.bottom + 6}px`
  rs.w.focus()
  rs.w.select()
}

rs.w.addEventListener('input', () => {
  if (rs.lock.checked) rs.h.value = String(Math.max(1, Math.round((Number(rs.w.value) * base.height) / base.width)))
})
rs.h.addEventListener('input', () => {
  if (rs.lock.checked) rs.w.value = String(Math.max(1, Math.round((Number(rs.h.value) * base.width) / base.height)))
})
$('#rs-presets').addEventListener('click', (e) => {
  const p = Number((e.target as HTMLElement).closest<HTMLElement>('[data-pct]')?.dataset.pct)
  if (!p) return
  rs.w.value = String(Math.max(1, Math.round((base.width * p) / 100)))
  rs.h.value = String(Math.max(1, Math.round((base.height * p) / 100)))
})
$('#rs-cancel').addEventListener('click', () => (rs.pop.hidden = true))
$('#rs-apply').addEventListener('click', applyResize)
rs.pop.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Enter') applyResize()
  else if (e.key === 'Escape') rs.pop.hidden = true
})

function applyResize(): void {
  const w = Math.round(Number(rs.w.value))
  const h = Math.round(Number(rs.h.value))
  rs.pop.hidden = true
  if (!w || !h || w < 1 || h < 1 || (w === base.width && h === base.height)) return
  if (w > 16000 || h > 16000) return toast('El tamaño máximo es 16 000 px por lado')
  commitText()
  tr.nodes([])
  const fx = w / base.width
  const fy = h / base.height
  scaleNodes(ann.getChildren().slice(), fx, fy)
  setBase(resizeCanvas(base, w, h))
  regenAll()
  zoom = null
  fit()
  pushHistory()
  toast(`Imagen redimensionada a ${w} × ${h} px`)
}

/** Avisa de un fallo al guardar o copiar (el detalle queda en mira.log). */
function failed(action: string, err: unknown): void {
  console.error(action, err)
  reportError(action, err)
  toast(`No se pudo ${action.toLowerCase()}. Inténtalo de nuevo.`, 5000)
}

async function copy(): Promise<void> {
  try {
    await api.invoke('editor:copy', await canvasBytes(render()))
    toast('Copiada al portapapeles')
  } catch (err) {
    failed('Copiar la imagen', err)
  }
}

function savedToast(): void {
  toast(`Guardada <a id="reveal">Mostrar en la carpeta</a>`, 4000)
  // El proceso principal muestra el último archivo que guardó este editor
  $('#reveal').onclick = () => api.send('editor:reveal')
}

// Un guardado en marcha bloquea los siguientes (Ctrl+S mantenido no guarda varias veces)
let saving = false

async function runSave(channel: 'editor:save' | 'editor:save-as'): Promise<boolean> {
  if (saving) return false
  saving = true
  // Se marca como guardado lo que había al pulsar, no lo que se edite mientras tanto
  const snap = history[hIndex]
  try {
    const file = await api.invoke(channel, await canvasBytes(render()))
    if (!file) return false
    markSaved(snap)
    savedToast()
    return true
  } catch (err) {
    failed('Guardar la imagen', err)
    return false
  } finally {
    saving = false
  }
}

const save = () => runSave('editor:save')
const saveAs = () => runSave('editor:save-as')

// ---------- Aviso al cerrar con cambios sin guardar ----------

const confirmBox = $('#confirm')
$<HTMLImageElement>('.cf-logo').src = LOGO_URL
let confirming = false

function openConfirm(): void {
  commitText()
  closeMenu()
  confirming = true
  confirmBox.hidden = false
  requestAnimationFrame(() => confirmBox.classList.add('in'))
  $<HTMLButtonElement>('#cf-save').focus()
}

function closeConfirm(): void {
  confirming = false
  confirmBox.classList.remove('in')
  setTimeout(() => (confirmBox.hidden = true), 150)
}

api.on('editor:confirm-close', openConfirm)
$('#cf-save').addEventListener('click', async () => {
  closeConfirm()
  if (await save()) api.send('editor:close-now')
})
$('#cf-discard').addEventListener('click', () => api.send('editor:close-now'))
$('#cf-cancel').addEventListener('click', closeConfirm)
confirmBox.addEventListener('pointerdown', (e) => {
  if (e.target === confirmBox) closeConfirm() // clic fuera de la tarjeta = cancelar
})
window.addEventListener(
  'keydown',
  (e) => {
    if (!confirming) return
    e.stopImmediatePropagation()
    if (e.key === 'Escape') closeConfirm()
  },
  true
)

// ---------- Teclado ----------

window.addEventListener('keydown', (e) => {
  if (editing || busy) return
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (mod && (k === '+' || k === '=' || e.code === 'NumpadAdd')) {
    e.preventDefault()
    stepZoom(1)
  } else if (mod && (k === '-' || e.code === 'NumpadSubtract')) {
    e.preventDefault()
    stepZoom(-1)
  } else if (mod && (k === '0' || e.code === 'Numpad0')) {
    e.preventDefault()
    setZoom(null)
  } else if (mod && (k === '1' || e.code === 'Numpad1')) {
    e.preventDefault()
    setZoom(1)
  } else if (mod && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && k === 'y') {
    e.preventDefault()
    redo()
  } else if (mod && k === 'c') {
    e.preventDefault()
    void copy()
  } else if (mod && k === 's') {
    e.preventDefault()
    if (e.shiftKey) void saveAs()
    else void save()
  } else if (mod && k === 'a') {
    e.preventDefault()
    setTool('select')
    select(ann.getChildren().slice())
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected()
  } else if (e.key === 'Escape') {
    if (!menu.hidden) closeMenu()
    else if (cropping) cancelCrop()
    else select([])
  } else if (e.key === 'Enter' && cropping) {
    applyCrop()
  } else if (!mod && !e.altKey && k === 'i') {
    void eyedrop()
  } else if (!mod && !e.altKey) {
    const t = TOOLS.find((x) => x.key === k)
    if (t) setTool(t.id)
  }
})

window.addEventListener('resize', () => fit())

// ---------- Arranque ----------

async function boot(): Promise<void> {
  buildToolbar()
  loadBgImage()
  renderBgPanel()
  const bytes = await api.invoke('editor:init')
  if (!bytes) return
  const img = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]))
  const c = canvasOf(img.width, img.height)
  c.getContext('2d')!.drawImage(img, 0, 0)
  img.close()
  setBase(c)
  fit()
  applyToolMode()
  pushHistory()
  markSaved()
}

void boot()
