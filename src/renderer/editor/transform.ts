// Rotar, voltear y redimensionar la imagen junto con sus anotaciones.
// Las anotaciones se recolocan geométricamente; los textos, contadores y etiquetas se mantienen
// derechos (legibles) y solo se mueve su posición.
import Konva from 'konva'
import { canvasOf } from './effects'

export type Op = 'rotL' | 'rotR' | 'flipH' | 'flipV'

interface P {
  x: number
  y: number
}

/** Transforma un punto de la imagen original (W×H) según la operación. */
export function mapPoint(p: P, op: Op, W: number, H: number): P {
  switch (op) {
    case 'rotR':
      return { x: H - p.y, y: p.x }
    case 'rotL':
      return { x: p.y, y: W - p.x }
    case 'flipH':
      return { x: W - p.x, y: p.y }
    case 'flipV':
      return { x: p.x, y: H - p.y }
  }
}

export function transformCanvas(src: HTMLCanvasElement, op: Op): HTMLCanvasElement {
  const rot = op === 'rotL' || op === 'rotR'
  const out = canvasOf(rot ? src.height : src.width, rot ? src.width : src.height)
  const ctx = out.getContext('2d')!
  if (op === 'rotR') {
    ctx.translate(out.width, 0)
    ctx.rotate(Math.PI / 2)
  } else if (op === 'rotL') {
    ctx.translate(0, out.height)
    ctx.rotate(-Math.PI / 2)
  } else if (op === 'flipH') {
    ctx.translate(out.width, 0)
    ctx.scale(-1, 1)
  } else {
    ctx.translate(0, out.height)
    ctx.scale(1, -1)
  }
  ctx.drawImage(src, 0, 0)
  return out
}

/** Escalado de alta calidad (reducciones a la mitad sucesivas para no perder nitidez). */
export function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = canvasOf(Math.round(cur.width / 2), Math.round(cur.height / 2))
    const c = half.getContext('2d')!
    c.imageSmoothingQuality = 'high'
    c.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
  }
  const out = canvasOf(w, h)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, w, h)
  return out
}

const POINTS = ['arrow', 'line', 'pen', 'highlighter']
const BOXES = ['rect', 'spotlight', 'effect']
const UPRIGHT = ['text', 'label', 'counter', 'magnifier']

/** Integra la escala del nodo en sus medidas (para poder transformarlo sin distorsiones). */
export function normalizeScale(n: Konva.Node): void {
  const sx = n.scaleX()
  const sy = n.scaleY()
  if (sx === 1 && sy === 1) return
  const name = n.name()
  const s = (sx + sy) / 2
  if (POINTS.includes(name)) {
    const l = n as Konva.Line
    l.points(l.points().map((v, i) => v * (i % 2 ? sy : sx)))
    l.strokeWidth(l.strokeWidth() * s)
    l.hitStrokeWidth(Number(l.hitStrokeWidth()) * s || 'auto')
    if (name === 'arrow') {
      const a = n as Konva.Arrow
      a.pointerLength(a.pointerLength() * s)
      a.pointerWidth(a.pointerWidth() * s)
    }
  } else if (name === 'rect' || name === 'spotlight') {
    n.setAttrs({ width: n.width() * sx, height: n.height() * sy })
    if (name === 'rect') (n as Konva.Rect).strokeWidth((n as Konva.Rect).strokeWidth() * s)
  } else if (name === 'ellipse') {
    const e = n as Konva.Ellipse
    e.setAttrs({ radiusX: e.radiusX() * sx, radiusY: e.radiusY() * sy, strokeWidth: e.strokeWidth() * s })
  } else if (name === 'effect' || name === 'magnifier') {
    n.setAttrs({ width: n.width() * sx, height: n.height() * sy })
    n.scale({ x: 1, y: 1 })
    return
  } else {
    // Textos, etiquetas y contadores conservan la escala (se reescalan como un todo)
    return
  }
  n.scale({ x: 1, y: 1 })
}

/** Recoloca las anotaciones tras rotar o voltear la imagen (W×H = tamaño ANTES de la operación). */
export function transformNodes(nodes: Konva.Node[], op: Op, W: number, H: number, parent: Konva.Container): void {
  const map = (p: P) => mapPoint(p, op, W, H)
  for (const n of nodes) {
    normalizeScale(n)
    const name = n.name()
    if (POINTS.includes(name)) {
      const l = n as Konva.Line
      const pts = l.points()
      const out: number[] = []
      for (let i = 0; i < pts.length; i += 2) {
        const q = map({ x: pts[i] + l.x(), y: pts[i + 1] + l.y() })
        out.push(q.x, q.y)
      }
      l.setAttrs({ x: 0, y: 0, points: out })
    } else if (BOXES.includes(name)) {
      const a = map({ x: n.x(), y: n.y() })
      const b = map({ x: n.x() + n.width(), y: n.y() + n.height() })
      n.setAttrs({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) })
    } else if (name === 'ellipse') {
      const e = n as Konva.Ellipse
      const c = map({ x: e.x(), y: e.y() })
      const rot = op === 'rotL' || op === 'rotR'
      e.setAttrs({ x: c.x, y: c.y, ...(rot ? { radiusX: e.radiusY(), radiusY: e.radiusX() } : {}) })
    } else if (UPRIGHT.includes(name)) {
      // Se mueve para que su centro caiga en el punto transformado, sin girarlo
      const r = n.getClientRect({ relativeTo: parent, skipShadow: true })
      const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      const q = map(c)
      n.position({ x: n.x() + q.x - c.x, y: n.y() + q.y - c.y })
    }
  }
}

/**
 * Escala las anotaciones tras redimensionar la imagen (fx, fy por eje). Textos, etiquetas,
 * contadores y lupas se escalan de forma uniforme para no deformarse.
 */
export function scaleNodes(nodes: Konva.Node[], fx: number, fy: number): void {
  const avg = Math.sqrt(fx * fy)
  for (const n of nodes) {
    n.position({ x: n.x() * fx, y: n.y() * fy })
    const upright = UPRIGHT.includes(n.name())
    n.scale({ x: n.scaleX() * (upright ? avg : fx), y: n.scaleY() * (upright ? avg : fy) })
    normalizeScale(n)
  }
}
