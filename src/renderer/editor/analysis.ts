// Análisis de la imagen y geometría del dibujo (funciones puras, sin estado del editor).

export interface Point {
  x: number
  y: number
}

/** Mayús: cuadrado/círculo ('box') o ángulos de 45° ('angle'). */
export function constrain(start: Point, p: Point, shift: boolean, mode: 'box' | 'angle'): Point {
  if (!shift) return p
  const dx = p.x - start.x
  const dy = p.y - start.y
  if (mode === 'box') {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: start.x + Math.sign(dx || 1) * m, y: start.y + Math.sign(dy || 1) * m }
  }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  const len = Math.hypot(dx, dy)
  return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len }
}

/** Simplificación Ramer-Douglas-Peucker: quita el temblor del pulso manteniendo la forma. */
export function simplify(pts: number[], eps: number): number[] {
  if (pts.length <= 4) return pts
  const n = pts.length / 2
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let best = -1
    let dmax = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / len
      if (d > dmax) {
        dmax = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

const pixels = (c: HTMLCanvasElement, x: number, y: number, w: number, h: number) =>
  c.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data

/** Perfiles de bordes (cambios fuertes de color) por columna y fila, para pegar el recorte a ellos. */
let edgeCache: { src: HTMLCanvasElement; col: Float32Array; row: Float32Array } | null = null
export function edgeProfiles(src: HTMLCanvasElement): { col: Float32Array; row: Float32Array } {
  if (edgeCache?.src === src) return edgeCache
  const w = src.width
  const h = src.height
  const d = pixels(src, 0, 0, w, h)
  const L = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  const col = new Float32Array(w)
  const row = new Float32Array(h)
  // Bordes verticales: todas las columnas (filas alternas); horizontales: todas las filas (columnas alternas)
  for (let y = 1; y < h; y += 2) for (let x = 1; x < w; x++) col[x] += Math.abs(L(x, y) - L(x - 1, y))
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x += 2) row[y] += Math.abs(L(x, y) - L(x, y - 1))
  edgeCache = { src, col, row }
  return edgeCache
}

/** Si cerca de v (±tol) hay un borde claro (4 veces la media), devuelve su posición; si no, v. */
export function snapTo(v: number, profile: Float32Array, tol: number): number {
  let mean = 0
  for (const p of profile) mean += p
  mean /= profile.length || 1
  let best = v
  let bestVal = mean * 4
  for (let i = Math.max(0, Math.round(v - tol)); i <= Math.min(profile.length - 1, Math.round(v + tol)); i++) {
    if (profile[i] > bestVal) {
      bestVal = profile[i]
      best = i
    }
  }
  return best
}

/** Resaltador inteligente: busca la franja de texto bajo el punto (altura de la línea) analizando la imagen. */
export function textBandAt(src: HTMLCanvasElement, px: number, py: number): { top: number; bottom: number } | null {
  const x0 = Math.max(0, Math.round(px - 60))
  const x1 = Math.min(src.width, Math.round(px + 60))
  const y0 = Math.max(0, Math.round(py - 90))
  const y1 = Math.min(src.height, Math.round(py + 90))
  if (x1 - x0 < 10 || y1 - y0 < 10) return null
  const w = x1 - x0
  const d = pixels(src, x0, y0, w, y1 - y0)
  const lum = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  // Color de fondo: la luminancia más frecuente de la zona
  const hist = new Uint32Array(32)
  for (let i = 0; i < d.length; i += 8) hist[Math.min(31, lum(i) >> 3)]++
  const bgLum = hist.indexOf(Math.max(...hist)) * 8 + 4
  const ink = (y: number) => {
    let n = 0
    for (let x = 0; x < w; x++) if (Math.abs(lum(((y - y0) * w + x) * 4) - bgLum) > 60) n++
    return n / w > 0.02
  }
  let y = Math.round(py)
  // Si justo bajo el cursor no hay tinta, se busca la línea más cercana (±12 px)
  if (!ink(y)) {
    let found = -1
    for (let k = 1; k <= 12 && found < 0; k++) {
      if (y - k >= y0 && ink(y - k)) found = y - k
      else if (y + k < y1 && ink(y + k)) found = y + k
    }
    if (found < 0) return null
    y = found
  }
  // Se toleran huecos de 2 px (entre el cuerpo de las letras y los acentos o rabitos)
  const extend = (from: number, dir: number, limit: number) => {
    let cur = from
    let gap = 0
    for (let yy = from + dir; dir < 0 ? yy >= limit : yy < limit; yy += dir) {
      if (ink(yy)) {
        cur = yy
        gap = 0
      } else if (++gap > 2) break
    }
    return cur
  }
  const top = extend(y, -1, y0)
  const bottom = extend(y, 1, y1)
  const h = bottom - top + 1
  return h >= 6 && h <= 140 ? { top, bottom } : null
}
