// Unión de fotogramas para la captura con desplazamiento.
// Detecta las bandas fijas (cabeceras/pies que no se mueven) y el desplazamiento vertical
// entre dos fotogramas comparando filas de luminancia muestreadas.

export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA
}

const SAMPLE_COLS = 128
const EDGE = 28 // columnas del borde derecho donde suele estar la barra de desplazamiento

/** Luminancia de columnas muestreadas de cada fila: rows[y * SAMPLE_COLS + i]. */
export function rowSignature(f: Frame): Float32Array {
  const cols = Math.min(SAMPLE_COLS, f.width)
  const sig = new Float32Array(f.height * SAMPLE_COLS)
  // Se ignoran 4 px a cada lado: el borde de la ventana cambia de color al ganar/perder el foco
  const m = f.width > 40 ? 4 : 0
  const inner = f.width - 2 * m
  for (let y = 0; y < f.height; y++)
    for (let i = 0; i < cols; i++) {
      const x = m + Math.floor(((i + 0.5) * inner) / cols)
      const p = (y * f.width + x) * 4
      sig[y * SAMPLE_COLS + i] = 0.299 * f.data[p] + 0.587 * f.data[p + 1] + 0.114 * f.data[p + 2]
    }
  return sig
}

function rowDiff(a: Float32Array, ra: number, b: Float32Array, rb: number, cols: number): number {
  let d = 0
  const oa = ra * SAMPLE_COLS
  const ob = rb * SAMPLE_COLS
  for (let i = 0; i < cols; i++) d += Math.abs(a[oa + i] - b[ob + i])
  return d / cols
}

function rowVariance(s: Float32Array, r: number, cols: number): number {
  let m = 0
  const o = r * SAMPLE_COLS
  for (let i = 0; i < cols; i++) m += s[o + i]
  m /= cols
  let v = 0
  for (let i = 0; i < cols; i++) v += (s[o + i] - m) ** 2
  return v / cols
}

export interface Bands {
  top: number
  bottom: number
}

/** Filas iguales arriba y abajo entre dos fotogramas (cabeceras fijas). null si no hay cambio. */
export function staticBands(a: Float32Array, b: Float32Array, h: number, cols: number): Bands | null {
  let top = 0
  while (top < h && rowDiff(a, top, b, top, cols) < 1.5) top++
  if (top >= h) return null // fotogramas idénticos: no se ha movido nada
  let bottom = 0
  while (bottom < h - top && rowDiff(a, h - 1 - bottom, b, h - 1 - bottom, cols) < 1.5) bottom++
  // Bandas fijas razonables: como mucho el 40 % de la altura cada una
  return { top: Math.min(top, Math.floor(h * 0.4)), bottom: Math.min(bottom, Math.floor(h * 0.4)) }
}

export interface Match {
  dy: number
  error: number
}

/**
 * Desplazamiento vertical del contenido entre A (antes) y B (después): la fila r de B
 * coincide con la fila r + dy de A. Solo se compara la zona central (sin bandas fijas)
 * usando las filas con más textura para evitar ambigüedades en zonas lisas.
 */
export function findOffset(
  a: Float32Array,
  b: Float32Array,
  h: number,
  cols: number,
  bands: Bands,
  prevDy = 0,
  full?: { fa: Frame; fb: Frame }
): Match | null {
  const top = bands.top
  const end = h - bands.bottom
  const midH = end - top
  if (midH < 20) return null
  const minOverlap = Math.max(12, Math.floor(midH * 0.08))

  // Filas de B con más contraste (repartidas)
  const candidates: Array<{ r: number; v: number }> = []
  for (let r = top; r < end; r++) candidates.push({ r, v: rowVariance(b, r, cols) })
  candidates.sort((x, y) => y.v - x.v)
  const sample = candidates
    .filter((c) => c.v > 4)
    .slice(0, 160)
    .map((c) => c.r)
    .sort((x, y) => x - y)
  if (sample.length < 4) return null // zona sin textura: no se puede alinear

  // 1.ª pasada (rápida, columnas muestreadas): los mejores candidatos
  const ranked: Match[] = []
  let worstKept = Infinity
  for (let dy = 1; dy <= midH - minOverlap; dy++) {
    let err = 0
    let n = 0
    for (const r of sample) {
      if (r + dy >= end) break
      err += rowDiff(a, r + dy, b, r, cols)
      n++
      if (ranked.length >= 8 && n >= 4 && err / n > worstKept * 3 + 20) break // poda
    }
    if (n < 4) continue
    let e = err / n
    // Ligera preferencia por desplazamientos parecidos al anterior (consistencia de la rueda)
    if (prevDy) e += (0.6 * Math.abs(dy - prevDy)) / midH
    ranked.push({ dy, error: e })
    ranked.sort((x, y) => x.error - y.error)
    if (ranked.length > 8) ranked.pop()
    worstKept = ranked[ranked.length - 1].error
  }
  if (!ranked.length) return null
  if (!full) return ranked[0]

  // 2.ª pasada (exacta, todas las columnas): distingue filas casi iguales (p. ej. solo cambian números)
  let best: Match | null = null
  for (const c of ranked) {
    let err = 0
    let n = 0
    for (const r of sample) {
      if (r + c.dy >= end) break
      err += pixelRowDiff(full.fa, r + c.dy, full.fb, r)
      n++
    }
    if (n < 4) continue
    const e = err / n + (prevDy ? (0.6 * Math.abs(c.dy - prevDy)) / midH : 0)
    if (!best || e < best.error) best = { dy: c.dy, error: e }
  }
  return best
}

/** Diferencia media de luminancia entre dos filas, píxel a píxel. */
function pixelRowDiff(fa: Frame, ra: number, fb: Frame, rb: number): number {
  const w = fa.width
  const oa = ra * w * 4
  const ob = rb * w * 4
  const m = w > 40 ? 4 : 0
  let d = 0
  for (let x = m; x < w - m; x++) {
    const i = oa + x * 4
    const j = ob + x * 4
    d += Math.abs(0.299 * (fa.data[i] - fb.data[j]) + 0.587 * (fa.data[i + 1] - fb.data[j + 1]) + 0.114 * (fa.data[i + 2] - fb.data[j + 2]))
  }
  return d / Math.max(1, w - 2 * m)
}

/** Acumula la imagen larga a partir de fotogramas sucesivos. */
export class Stitcher {
  private chunks: ImageData[] = []
  private push(c: ImageData | null): void {
    if (c) this.chunks.push(c)
  }
  private bands: Bands | null = null
  private prev: Frame | null = null
  private prevSig: Float32Array | null = null
  private last: Frame | null = null
  height = 0
  lastDy = 0
  /** Diferencia acumulada de las últimas columnas (para detectar la barra de desplazamiento) */
  private edgeDiff = new Float64Array(EDGE)
  private edgeSamples = 0

  constructor(
    private readonly width: number,
    private readonly frameH: number
  ) {}

  /**
   * Añade un fotograma. Devuelve el desplazamiento detectado (0 si no hubo cambio,
   * -1 si no se pudo alinear).
   */
  add(f: Frame): number {
    const sig = rowSignature(f)
    const cols = Math.min(SAMPLE_COLS, f.width)
    if (!this.prev || !this.prevSig) {
      this.prev = f
      this.prevSig = sig
      this.last = f
      this.height = f.height
      return 0
    }
    const bands = this.bands ?? staticBands(this.prevSig, sig, this.frameH, cols)
    if (!bands) return 0
    // ¿Fotogramas iguales en la zona central? (no se ha desplazado: final de la página)
    let same = 0
    let n = 0
    for (let r = bands.top; r < this.frameH - bands.bottom; r += 3) {
      same += rowDiff(this.prevSig, r, sig, r, cols)
      n++
    }
    if (n && same / n < 0.8) return 0
    const m = findOffset(this.prevSig, sig, this.frameH, cols, bands, this.lastDy, { fa: this.prev, fb: f })
    if (!m) return -1
    if (m.error > 9) return -1
    const end = this.frameH - bands.bottom
    // Primer emparejamiento: se fijan las bandas y se guarda el primer fotograma sin el pie
    if (!this.bands) {
      this.bands = bands
      this.push(slice(this.prev, 0, end))
    }
    this.push(slice(f, end - m.dy, end))
    this.measureEdge(this.prev, f, m.dy, bands)
    this.prev = f
    this.prevSig = sig
    this.last = f
    this.lastDy = m.dy
    this.height = this.chunks.reduce((s, c) => s + c.height, 0) + bands.bottom
    return m.dy
  }

  /** Compara las columnas del borde derecho ya alineadas: si no cuadran, es la barra de scroll. */
  private measureEdge(a: Frame, b: Frame, dy: number, bands: Bands): void {
    const w = a.width
    const end = this.frameH - bands.bottom
    for (let r = bands.top; r + dy < end; r += 4) {
      for (let k = 0; k < EDGE && k < w; k++) {
        const x = w - 1 - k
        const i = ((r + dy) * w + x) * 4
        const j = (r * w + x) * 4
        this.edgeDiff[k] += Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2])
      }
      this.edgeSamples++
    }
  }

  /** Columnas a recortar por la derecha (barra de desplazamiento que se movía). */
  scrollbarWidth(): number {
    if (!this.edgeSamples) return 0
    const score = Array.from(this.edgeDiff, (d) => d / this.edgeSamples)
    // Columna más a la izquierda (dentro de la franja) que no cuadra con el desplazamiento
    let k = -1
    for (let i = 0; i < EDGE; i++) if (score[i] > 6) k = i
    // Solo se recorta si es una franja estrecha pegada al borde (y el resto sí cuadra)
    return k >= 3 && k < EDGE - 4 ? k + 1 : 0
  }

  /** Imagen final (con el pie fijo del último fotograma). */
  result(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = this.width
    if (!this.bands || !this.last) {
      canvas.height = this.prev?.height ?? 1
      if (this.prev) canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(this.prev.data), this.prev.width, this.prev.height), 0, 0)
      return canvas
    }
    const footer = slice(this.last, this.frameH - this.bands.bottom, this.frameH)
    const parts = footer ? [...this.chunks, footer] : this.chunks
    canvas.width = this.width - this.scrollbarWidth()
    canvas.height = parts.reduce((s, c) => s + c.height, 0)
    const ctx = canvas.getContext('2d')!
    let y = 0
    for (const p of parts) {
      ctx.putImageData(p, 0, y)
      y += p.height
    }
    return canvas
  }
}

/** Filas [y0, y1) de un fotograma, o null si no hay filas. */
function slice(f: Frame, y0: number, y1: number): ImageData | null {
  const h = y1 - y0
  if (h <= 0) return null
  const out = new ImageData(f.width, h)
  out.data.set(f.data.subarray(y0 * f.width * 4, y1 * f.width * 4))
  return out
}
