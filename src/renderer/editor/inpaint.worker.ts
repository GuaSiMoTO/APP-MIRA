// Relleno según contenido: PatchMatch multiescala con votación (estilo Wexler et al.).
// Rellena el hueco (máscara = 1) copiando parches de textura de la zona conocida que lo rodea.

export interface InpaintRequest {
  width: number
  height: number
  /** Imagen RGBA de la zona de trabajo */
  data: Uint8ClampedArray
  /** Misma zona con el hueco ya relleno por interpolación de bordes (inicialización) */
  init: Uint8ClampedArray
  /** 1 = píxel del hueco */
  mask: Uint8Array
}

export interface InpaintResponse {
  data: Uint8ClampedArray
  ms: number
}

const R = 3 // parche de 7×7
const MIN_HOLE = 40 // tamaño del hueco en el nivel más pequeño

interface Level {
  w: number
  h: number
  img: Float32Array // RGB
  mask: Uint8Array
}

function toRgb(src: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    out[i * 3] = src[i * 4]
    out[i * 3 + 1] = src[i * 4 + 1]
    out[i * 3 + 2] = src[i * 4 + 2]
  }
  return out
}

function downsample(l: Level): Level {
  const w = Math.max(1, l.w >> 1)
  const h = Math.max(1, l.h >> 1)
  const img = new Float32Array(w * h * 3)
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hole = 0
      const acc = [0, 0, 0]
      let n = 0
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, x * 2 + dx)
          const sy = Math.min(l.h - 1, y * 2 + dy)
          const si = sy * l.w + sx
          if (l.mask[si]) hole = 1
          acc[0] += l.img[si * 3]
          acc[1] += l.img[si * 3 + 1]
          acc[2] += l.img[si * 3 + 2]
          n++
        }
      const i = y * w + x
      mask[i] = hole
      img[i * 3] = acc[0] / n
      img[i * 3 + 1] = acc[1] / n
      img[i * 3 + 2] = acc[2] / n
    }
  return { w, h, img, mask }
}

function holeSize(l: Level): number {
  let x0 = l.w, y0 = l.h, x1 = -1, y1 = -1
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++)
      if (l.mask[y * l.w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1)
}

/** Centros cuyo parche entero cae dentro de la imagen y fuera del hueco. */
function validSources(l: Level): Uint8Array {
  const { w, h, mask } = l
  // Suma acumulada de la máscara para consultar rápido si un parche toca el hueco
  const sat = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sat[(y + 1) * (w + 1) + x + 1] = mask[y * w + x] + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x]
  const ok = new Uint8Array(w * h)
  for (let y = R; y < h - R; y++)
    for (let x = R; x < w - R; x++) {
      const a = (y - R) * (w + 1) + (x - R)
      const b = (y - R) * (w + 1) + (x + R + 1)
      const c = (y + R + 1) * (w + 1) + (x - R)
      const d = (y + R + 1) * (w + 1) + (x + R + 1)
      if (sat[d] - sat[b] - sat[c] + sat[a] === 0) ok[y * w + x] = 1
    }
  return ok
}

/** Píxeles cuyo parche toca el hueco (los que votan). */
function targets(l: Level): Int32Array {
  const { w, h, mask } = l
  const near = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x])
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx
            if (xx >= 0 && xx < w) near[yy * w + xx] = 1
          }
        }
  const list: number[] = []
  for (let i = 0; i < w * h; i++) if (near[i]) list.push(i)
  return Int32Array.from(list)
}

function patchDist(l: Level, tx: number, ty: number, sx: number, sy: number, best: number): number {
  const { w, h, img } = l
  let d = 0
  for (let dy = -R; dy <= R; dy++) {
    const ty2 = ty + dy
    if (ty2 < 0 || ty2 >= h) continue
    const trow = ty2 * w
    const srow = (sy + dy) * w
    for (let dx = -R; dx <= R; dx++) {
      const tx2 = tx + dx
      if (tx2 < 0 || tx2 >= w) continue
      const ti = (trow + tx2) * 3
      const si = (srow + sx + dx) * 3
      const r = img[ti] - img[si]
      const g = img[ti + 1] - img[si + 1]
      const b = img[ti + 2] - img[si + 2]
      d += r * r + g * g + b * b
    }
    if (d >= best) return d
  }
  return d
}

function randomValid(valid: Uint8Array, pool: Int32Array): number {
  return pool[(Math.random() * pool.length) | 0]
}

function patchMatch(l: Level, tg: Int32Array, nnf: Int32Array, nnd: Float64Array, valid: Uint8Array, iterIdx: number): void {
  const { w, h } = l
  const forward = iterIdx % 2 === 0
  const n = tg.length
  const maxR = Math.max(w, h)
  for (let k = 0; k < n; k++) {
    const t = tg[forward ? k : n - 1 - k]
    const tx = t % w
    const ty = (t / w) | 0
    let best = nnd[t]
    let bestS = nnf[t]
    // Propagación desde los vecinos ya procesados
    const step = forward ? -1 : 1
    for (const [nx, ny] of [
      [tx + step, ty],
      [tx, ty + step]
    ]) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const nb = ny * w + nx
      const ns = nnf[nb]
      if (ns < 0) continue
      const sx = (ns % w) - (nx - tx)
      const sy = ((ns / w) | 0) - (ny - ty)
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
      const s = sy * w + sx
      if (!valid[s] || s === bestS) continue
      const d = patchDist(l, tx, ty, sx, sy, best)
      if (d < best) {
        best = d
        bestS = s
      }
    }
    // Búsqueda aleatoria con radio decreciente
    const bx = bestS % w
    const by = (bestS / w) | 0
    for (let rad = maxR; rad >= 1; rad >>= 1) {
      const sx = Math.round(bx + (Math.random() * 2 - 1) * rad)
      const sy = Math.round(by + (Math.random() * 2 - 1) * rad)
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
      const s = sy * w + sx
      if (!valid[s]) continue
      const d = patchDist(l, tx, ty, sx, sy, best)
      if (d < best) {
        best = d
        bestS = s
      }
    }
    nnf[t] = bestS
    nnd[t] = best
  }
}

function vote(l: Level, tg: Int32Array, nnf: Int32Array, nnd: Float64Array): void {
  const { w, h, img, mask } = l
  // Peso según la calidad del parche: sigma² = percentil 75 de las distancias
  const sample: number[] = []
  for (let k = 0; k < tg.length; k += Math.max(1, (tg.length / 2000) | 0)) sample.push(nnd[tg[k]])
  sample.sort((a, b) => a - b)
  const sigma2 = Math.max(1, sample[Math.floor(sample.length * 0.75)] ?? 1)

  const acc = new Float32Array(w * h * 3)
  const ws = new Float32Array(w * h)
  for (const t of tg) {
    const s = nnf[t]
    const wgt = Math.exp(-nnd[t] / (2 * sigma2)) + 1e-6
    const tx = t % w
    const ty = (t / w) | 0
    const sx = s % w
    const sy = (s / w) | 0
    for (let dy = -R; dy <= R; dy++) {
      const py = ty + dy
      if (py < 0 || py >= h) continue
      for (let dx = -R; dx <= R; dx++) {
        const px = tx + dx
        if (px < 0 || px >= w) continue
        const p = py * w + px
        if (!mask[p]) continue
        const si = ((sy + dy) * w + sx + dx) * 3
        acc[p * 3] += wgt * img[si]
        acc[p * 3 + 1] += wgt * img[si + 1]
        acc[p * 3 + 2] += wgt * img[si + 2]
        ws[p] += wgt
      }
    }
  }
  for (let p = 0; p < w * h; p++)
    if (mask[p] && ws[p] > 0) {
      img[p * 3] = acc[p * 3] / ws[p]
      img[p * 3 + 1] = acc[p * 3 + 1] / ws[p]
      img[p * 3 + 2] = acc[p * 3 + 2] / ws[p]
    }
}

/**
 * Inicialización "de fuera hacia dentro" en el nivel más pequeño: cada píxel del hueco,
 * en orden de distancia al borde, copia el centro del parche que mejor encaja con los
 * píxeles ya conocidos o rellenados. Evita que un relleno suave atraiga parches lisos.
 */
function onionInit(l: Level, valid: Uint8Array, pool: Int32Array): void {
  const { w, h, img, mask } = l
  const filled = new Uint8Array(w * h)
  const dist = new Int32Array(w * h).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < w * h; i++)
    if (!mask[i]) {
      filled[i] = 1
      dist[i] = 0
    }
  // Píxeles del hueco en orden BFS desde el borde
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const x = i % w
    const y = (i / w) | 0
    if ((x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) || (y > 0 && !mask[i - w]) || (y < h - 1 && !mask[i + w])) {
      dist[i] = 1
      queue.push(i)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const x = i % w
    const y = (i / w) | 0
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && mask[j] && dist[j] < 0) {
        dist[j] = dist[i] + 1
        queue.push(j)
      }
    }
  }

  const chosen = new Int32Array(w * h).fill(-1)
  const partialDist = (tx: number, ty: number, sx: number, sy: number): number => {
    let d = 0
    let n = 0
    for (let dy = -R; dy <= R; dy++) {
      const ty2 = ty + dy
      if (ty2 < 0 || ty2 >= h) continue
      for (let dx = -R; dx <= R; dx++) {
        const tx2 = tx + dx
        if (tx2 < 0 || tx2 >= w) continue
        const t = ty2 * w + tx2
        if (!filled[t]) continue
        const ti = t * 3
        const si = ((sy + dy) * w + sx + dx) * 3
        const r = img[ti] - img[si]
        const g = img[ti + 1] - img[si + 1]
        const b = img[ti + 2] - img[si + 2]
        d += r * r + g * g + b * b
        n++
      }
    }
    return n ? d / n : Infinity
  }

  // En este nivel la zona es pequeña: se prueban todos los candidatos (o una muestra grande)
  const exhaustive = pool.length <= 6000
  const maxDim = Math.max(w, h)
  for (const p of queue) {
    const tx = p % w
    const ty = (p / w) | 0
    let best = Infinity
    let bestS = pool[0]
    const tryS = (s: number) => {
      if (s < 0 || !valid[s]) return
      const sx = s % w
      const sy = (s / w) | 0
      // Preferencia por parches cercanos: la textura de al lado suele ser la correcta
      const near = 1 + (2 * Math.hypot(sx - tx, sy - ty)) / maxDim
      const d = partialDist(tx, ty, sx, sy) * near
      if (d < best) {
        best = d
        bestS = s
      }
    }
    // Coherencia: continuar el parche elegido por los vecinos ya rellenados
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx
        const ny = ty + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const c = chosen[ny * w + nx]
        if (c < 0) continue
        const sx = (c % w) - dx
        const sy = ((c / w) | 0) - dy
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) tryS(sy * w + sx)
      }
    if (exhaustive) for (let k = 0; k < pool.length; k++) tryS(pool[k])
    else for (let k = 0; k < 3000; k++) tryS(pool[(Math.random() * pool.length) | 0])
    chosen[p] = bestS
    img[p * 3] = img[bestS * 3]
    img[p * 3 + 1] = img[bestS * 3 + 1]
    img[p * 3 + 2] = img[bestS * 3 + 2]
    filled[p] = 1
  }
}

export function inpaint(req: InpaintRequest): Uint8ClampedArray {
  const { width: w, height: h, data, init, mask } = req
  const n = w * h

  // Pirámide sobre la imagen ya inicializada (el hueco tiene el relleno por bordes)
  const levels: Level[] = [{ w, h, img: toRgb(init, n), mask: mask.slice() }]
  while (holeSize(levels[levels.length - 1]) > MIN_HOLE && levels[levels.length - 1].w > 4 * R * 2) {
    levels.push(downsample(levels[levels.length - 1]))
  }

  let prevNnf: Int32Array | null = null
  let prevLevel: Level | null = null

  for (let li = levels.length - 1; li >= 0; li--) {
    const l = levels[li]
    const valid = validSources(l)
    const pool: number[] = []
    for (let i = 0; i < valid.length; i++) if (valid[i]) pool.push(i)
    if (!pool.length) continue // no hay de dónde copiar: se queda la inicialización
    const poolArr = Int32Array.from(pool)
    const tg = targets(l)
    if (!prevLevel) onionInit(l, valid, poolArr)

    // Subir el resultado del nivel anterior a los píxeles del hueco
    if (prevLevel) {
      for (let y = 0; y < l.h; y++)
        for (let x = 0; x < l.w; x++) {
          const i = y * l.w + x
          if (!l.mask[i]) continue
          const px = Math.min(prevLevel.w - 1, x >> 1)
          const py = Math.min(prevLevel.h - 1, y >> 1)
          const pi = (py * prevLevel.w + px) * 3
          l.img[i * 3] = prevLevel.img[pi]
          l.img[i * 3 + 1] = prevLevel.img[pi + 1]
          l.img[i * 3 + 2] = prevLevel.img[pi + 2]
        }
    }

    const nnf = new Int32Array(l.w * l.h).fill(-1)
    const nnd = new Float64Array(l.w * l.h)
    for (const t of tg) {
      let s = -1
      if (prevNnf && prevLevel) {
        // Escalar la correspondencia del nivel anterior
        const tx = t % l.w
        const ty = (t / l.w) | 0
        const pt = Math.min(prevLevel.h - 1, ty >> 1) * prevLevel.w + Math.min(prevLevel.w - 1, tx >> 1)
        const ps = prevNnf[pt]
        if (ps >= 0) {
          const sx = (ps % prevLevel.w) * 2 + (tx & 1)
          const sy = ((ps / prevLevel.w) | 0) * 2 + (ty & 1)
          const cand = sy * l.w + sx
          if (sx < l.w && sy < l.h && valid[cand]) s = cand
        }
      }
      if (s < 0) s = randomValid(valid, poolArr)
      nnf[t] = s
      nnd[t] = patchDist(l, t % l.w, (t / l.w) | 0, s % l.w, (s / l.w) | 0, Infinity)
    }

    const iters = li === levels.length - 1 ? 8 : li === 0 ? 3 : 5
    for (let it = 0; it < iters; it++) {
      patchMatch(l, tg, nnf, nnd, valid, it * 2)
      patchMatch(l, tg, nnf, nnd, valid, it * 2 + 1)
      vote(l, tg, nnf, nnd)
      // Tras votar cambian los píxeles del hueco: se recalculan las distancias
      for (const t of tg) nnd[t] = patchDist(l, t % l.w, (t / l.w) | 0, nnf[t] % l.w, (nnf[t] / l.w) | 0, Infinity)
    }
    prevNnf = nnf
    prevLevel = l
  }

  const out = new Uint8ClampedArray(data)
  const fin = levels[0]
  for (let i = 0; i < n; i++)
    if (mask[i]) {
      out[i * 4] = fin.img[i * 3]
      out[i * 4 + 1] = fin.img[i * 3 + 1]
      out[i * 4 + 2] = fin.img[i * 3 + 2]
      out[i * 4 + 3] = init[i * 4 + 3]
    }
  return out
}

// Punto de entrada del worker (no se ejecuta si se importa desde otro contexto)
declare const WorkerGlobalScope: { new (): unknown } | undefined
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e: MessageEvent<InpaintRequest>) => {
    const t0 = performance.now()
    const data = inpaint(e.data)
    const res: InpaintResponse = { data, ms: performance.now() - t0 }
    ;(self as unknown as Worker).postMessage(res, [data.buffer])
  }
}
