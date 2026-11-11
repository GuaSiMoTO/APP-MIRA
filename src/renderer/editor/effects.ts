// Procesado de imagen del editor: pixelado, desenfoque, quitar objeto y recorte.
// Todas las funciones devuelven lienzos nuevos (no modifican el original) para que el historial funcione.

export interface IRect {
  x: number
  y: number
  width: number
  height: number
}

export function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function clampRect(r: IRect, w: number, h: number): IRect | null {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.width))
  const y1 = Math.min(h, Math.ceil(r.y + r.height))
  return x1 - x >= 2 && y1 - y >= 2 ? { x, y, width: x1 - x, height: y1 - y } : null
}

export function pixelate(src: HTMLCanvasElement, r: IRect, block: number): HTMLCanvasElement {
  const out = canvasOf(r.width, r.height)
  const tw = Math.max(1, Math.ceil(r.width / block))
  const th = Math.max(1, Math.ceil(r.height / block))
  const small = canvasOf(tw, th)
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, tw, th)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, tw, th, 0, 0, tw * block, th * block)
  return out
}

export function blur(src: HTMLCanvasElement, r: IRect, radius: number): HTMLCanvasElement {
  // Margen alrededor para que los bordes no queden transparentes
  const m = Math.ceil(radius * 2)
  const sx = Math.max(0, r.x - m)
  const sy = Math.max(0, r.y - m)
  const sw = Math.min(src.width, r.x + r.width + m) - sx
  const sh = Math.min(src.height, r.y + r.height + m) - sy
  // Desenfoque "seguro": antes de desenfocar se reduce mucho la resolución de la zona, así el
  // detalle se pierde de verdad y el texto no puede recuperarse de la imagen exportada
  const coarse = pixelate(src, { x: sx, y: sy, width: sw, height: sh }, Math.max(2, Math.round(radius / 2)))
  const out = canvasOf(r.width, r.height)
  const ctx = out.getContext('2d')!
  const ox = r.x - sx
  const oy = r.y - sy
  ctx.filter = `blur(${radius}px)`
  // Dos pasadas: primero el bloque ampliado (rellena los bordes) y luego la zona con su entorno
  ctx.drawImage(coarse, ox, oy, r.width, r.height, -m, -m, r.width + 2 * m, r.height + 2 * m)
  ctx.drawImage(coarse, 0, 0, sw, sh, -ox, -oy, sw, sh)
  ctx.filter = 'none'
  return out
}

/**
 * "Quitar objeto": rellena la zona interpolando los píxeles del borde que la rodea
 * (media ponderada por distancia inversa de los cuatro lados). Ideal para fondos de
 * interfaz planos o con degradado suave.
 */
export function removeArea(src: HTMLCanvasElement, rect: IRect): HTMLCanvasElement {
  const W = src.width
  const H = src.height
  const r = clampRect(rect, W, H)
  const out = canvasOf(W, H)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  if (!r) return out

  // Región de trabajo con 3 px de margen para muestrear el borde
  const M = 3
  const ox = Math.max(0, r.x - M)
  const oy = Math.max(0, r.y - M)
  const ow = Math.min(W, r.x + r.width + M) - ox
  const oh = Math.min(H, r.y + r.height + M) - oy
  const img = ctx.getImageData(ox, oy, ow, oh)
  const d = img.data
  const at = (x: number, y: number) => ((y - oy) * ow + (x - ox)) * 4

  const x0 = r.x
  const y0 = r.y
  const x1 = r.x + r.width // exclusivo
  const y1 = r.y + r.height
  const hasL = x0 > 0
  const hasR = x1 < W
  const hasT = y0 > 0
  const hasB = y1 < H

  // Media de una franja de hasta 3 px fuera del borde para reducir ruido
  const sampleCol = (side: 'L' | 'R', y: number): number[] => {
    const acc = [0, 0, 0, 0]
    let n = 0
    for (let k = 1; k <= M; k++) {
      const x = side === 'L' ? x0 - k : x1 - 1 + k
      if (x < ox || x >= ox + ow) break
      const i = at(x, y)
      for (let c = 0; c < 4; c++) acc[c] += d[i + c]
      n++
    }
    return acc.map((v) => v / Math.max(1, n))
  }
  const sampleRow = (side: 'T' | 'B', x: number): number[] => {
    const acc = [0, 0, 0, 0]
    let n = 0
    for (let k = 1; k <= M; k++) {
      const y = side === 'T' ? y0 - k : y1 - 1 + k
      if (y < oy || y >= oy + oh) break
      const i = at(x, y)
      for (let c = 0; c < 4; c++) acc[c] += d[i + c]
      n++
    }
    return acc.map((v) => v / Math.max(1, n))
  }

  // Suavizado 1D de cada borde (caja de radio 3) para que el texto que toca el borde no deje rayas
  const smooth = (arr: number[][]): number[][] => {
    const R = 3
    return arr.map((_, i) => {
      const acc = [0, 0, 0, 0]
      let n = 0
      for (let j = Math.max(0, i - R); j <= Math.min(arr.length - 1, i + R); j++) {
        for (let c = 0; c < 4; c++) acc[c] += arr[j][c]
        n++
      }
      return acc.map((v) => v / n)
    })
  }

  const rows = r.height
  const cols = r.width
  const L = hasL ? smooth(Array.from({ length: rows }, (_, k) => sampleCol('L', y0 + k))) : null
  const Rr = hasR ? smooth(Array.from({ length: rows }, (_, k) => sampleCol('R', y0 + k))) : null
  const T = hasT ? smooth(Array.from({ length: cols }, (_, k) => sampleRow('T', x0 + k))) : null
  const B = hasB ? smooth(Array.from({ length: cols }, (_, k) => sampleRow('B', x0 + k))) : null

  for (let y = y0; y < y1; y++) {
    const ry = y - y0
    for (let x = x0; x < x1; x++) {
      const rx = x - x0
      let wsum = 0
      const acc = [0, 0, 0, 0]
      const add = (c: number[] | undefined, dist: number) => {
        if (!c) return
        const w = 1 / (dist * dist)
        wsum += w
        for (let k = 0; k < 4; k++) acc[k] += c[k] * w
      }
      add(L?.[ry], rx + 1)
      add(Rr?.[ry], cols - rx)
      add(T?.[rx], ry + 1)
      add(B?.[rx], rows - ry)
      const i = at(x, y)
      if (wsum === 0) {
        d[i] = d[i + 1] = d[i + 2] = 255
        d[i + 3] = 255
      } else {
        for (let k = 0; k < 4; k++) d[i + k] = acc[k] / wsum
      }
    }
  }
  ctx.putImageData(img, ox, oy)
  return out
}

/** Color medio de una franja de 3 px alrededor de la zona (para el relleno plano automático). */
export function borderMean(src: HTMLCanvasElement, r: IRect): string {
  const M = 3
  const x0 = Math.max(0, r.x - M)
  const y0 = Math.max(0, r.y - M)
  const x1 = Math.min(src.width, r.x + r.width + M)
  const y1 = Math.min(src.height, r.y + r.height + M)
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, x1 - x0, y1 - y0).data
  const w = x1 - x0
  let rs = 0, gs = 0, bs = 0, n = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) continue
      const i = ((y - y0) * w + (x - x0)) * 4
      rs += d[i]
      gs += d[i + 1]
      bs += d[i + 2]
      n++
    }
  if (!n) return '#ffffff'
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return `#${hex(rs)}${hex(gs)}${hex(bs)}`
}

/** "Quitar objeto" con color plano: el elegido o, si es null, el color medio del borde. */
export function fillSolid(src: HTMLCanvasElement, rect: IRect, color: string | null): HTMLCanvasElement {
  const out = canvasOf(src.width, src.height)
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  const r = clampRect(rect, src.width, src.height)
  if (!r) return out
  ctx.fillStyle = color ?? borderMean(src, r)
  ctx.fillRect(r.x, r.y, r.width, r.height)
  return out
}

export function crop(src: HTMLCanvasElement, r: IRect): HTMLCanvasElement {
  const out = canvasOf(r.width, r.height)
  out.getContext('2d')!.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
  return out
}

export type BgAlign = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br'
export type BgRatio = 'auto' | '1:1' | '4:3' | '16:9' | '9:16'

export interface Background {
  enabled: boolean
  kind: 'gradient' | 'solid' | 'image'
  colors: [string, string]
  /** Imagen propia (data URL), si kind = 'image' */
  image: string | null
  padding: number
  radius: number
  shadow: boolean
  align: BgAlign
  ratio: BgRatio
  /** Auto Balance: quita los márgenes uniformes de la captura para que el espacio quede igual */
  balance: boolean
}

export interface BgLayout {
  /** Tamaño final */
  W: number
  H: number
  /** Posición de la captura dentro del fondo */
  x: number
  y: number
}

const ALIGN: Record<BgAlign, [number, number]> = {
  tl: [0, 0],
  t: [0.5, 0],
  tr: [1, 0],
  l: [0, 0.5],
  c: [0.5, 0.5],
  r: [1, 0.5],
  bl: [0, 1],
  b: [0.5, 1],
  br: [1, 1]
}

/** Geometría del fondo: tamaño según margen y proporción, y posición según la alineación. */
export function bgLayout(w: number, h: number, bg: Background, unit: number): BgLayout {
  const pad = Math.round(bg.padding * unit)
  let W = w + pad * 2
  let H = h + pad * 2
  if (bg.ratio !== 'auto') {
    const [rw, rh] = bg.ratio.split(':').map(Number)
    const R = rw / rh
    if (W / H < R) W = Math.round(H * R)
    else H = Math.round(W / R)
  }
  const [ax, ay] = ALIGN[bg.align] ?? ALIGN.c
  return { W, H, x: Math.round(pad + (W - w - pad * 2) * ax), y: Math.round(pad + (H - h - pad * 2) * ay) }
}

/**
 * Zona con contenido real: se descartan los bordes de color uniforme (igual que la esquina
 * superior izquierda). Sirve para el Auto Balance.
 */
export function contentBox(src: HTMLCanvasElement): IRect {
  const w = src.width
  const h = src.height
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const r0 = d[0]
  const g0 = d[1]
  const b0 = d[2]
  const same = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) < 24
  }
  const rowEmpty = (y: number) => {
    for (let x = 0; x < w; x += 2) if (!same(x, y)) return false
    return true
  }
  const colEmpty = (x: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y += 2) if (!same(x, y)) return false
    return true
  }
  let top = 0
  while (top < h - 1 && rowEmpty(top)) top++
  if (top >= h - 1) return { x: 0, y: 0, width: w, height: h } // imagen de un solo color
  let bottom = h - 1
  while (bottom > top && rowEmpty(bottom)) bottom--
  let left = 0
  while (left < w - 1 && colEmpty(left, top, bottom + 1)) left++
  let right = w - 1
  while (right > left && colEmpty(right, top, bottom + 1)) right--
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** Relleno del fondo: degradado, color liso o imagen (ajustada para cubrir). */
function paintBackground(ctx: CanvasRenderingContext2D, W: number, H: number, bg: Background, image: HTMLImageElement | null): void {
  if (bg.kind === 'image' && image?.naturalWidth) {
    const s = Math.max(W / image.naturalWidth, H / image.naturalHeight)
    const iw = image.naturalWidth * s
    const ih = image.naturalHeight * s
    ctx.drawImage(image, (W - iw) / 2, (H - ih) / 2, iw, ih)
    return
  }
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.colors[0]
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, bg.colors[0])
    g.addColorStop(1, bg.colors[1])
    ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, W, H)
}

/**
 * Compone la imagen final con el fondo decorativo. `crop` es la parte de la captura que se
 * usa (toda, o sin márgenes uniformes con Auto Balance).
 */
export function composeBackground(
  img: HTMLCanvasElement,
  bg: Background,
  unit: number,
  crop?: IRect,
  image: HTMLImageElement | null = null
): HTMLCanvasElement {
  if (!bg.enabled) return img
  const c = crop ?? { x: 0, y: 0, width: img.width, height: img.height }
  const L = bgLayout(c.width, c.height, bg, unit)
  const radius = Math.round(bg.radius * unit)
  const out = canvasOf(L.W, L.H)
  const ctx = out.getContext('2d')!
  paintBackground(ctx, L.W, L.H, bg, image)

  const path = new Path2D()
  path.roundRect(L.x, L.y, c.width, c.height, radius)
  if (bg.shadow) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 36 * unit
    ctx.shadowOffsetY = 12 * unit
    ctx.fillStyle = '#000'
    ctx.fill(path)
    ctx.restore()
  }
  ctx.save()
  ctx.clip(path)
  ctx.drawImage(img, c.x, c.y, c.width, c.height, L.x, L.y, c.width, c.height)
  ctx.restore()
  return out
}

/** Fondo CSS equivalente (para la vista dentro del editor). */
export function backgroundCss(bg: Background): string {
  if (bg.kind === 'image' && bg.image) return `center / cover no-repeat url('${bg.image}')` // comillas simples: se usa también dentro de style="…"
  if (bg.kind === 'solid') return bg.colors[0]
  return `linear-gradient(to bottom right, ${bg.colors[0]}, ${bg.colors[1]})`
}
