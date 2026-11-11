import { describe, expect, it } from 'vitest'
import { findOffset, rowSignature, staticBands, type Frame } from '../src/renderer/scroll/stitch'

const W = 200
const H = 300

/** «Página» larga con textura pseudoaleatoria determinista (como texto e imágenes). */
function page(height: number, seed = 1): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * height * 4)
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < height; y++) {
    // Cada fila tiene su propio patrón de bloques de distinto brillo
    const base = rnd() * 200
    for (let x = 0; x < W; x++) {
      const v = (base + (Math.floor(x / (4 + (y % 7))) % 2) * 50 + rnd() * 10) | 0
      const p = (y * W + x) * 4
      data[p] = data[p + 1] = data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return data
}

/** Fotograma de la ventana: cabecera fija de `header` filas y el contenido desplazado `scroll` filas. */
function frame(src: Uint8ClampedArray, scroll: number, header = 0): Frame {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    const from = y < header ? y : y + scroll
    data.set(src.subarray(from * W * 4, (from + 1) * W * 4), y * W * 4)
  }
  return { width: W, height: H, data }
}

describe('staticBands', () => {
  it('devuelve null si los fotogramas son idénticos (la página no se movió)', () => {
    const src = page(1000)
    const a = rowSignature(frame(src, 0))
    expect(staticBands(a, a, H, 128)).toBeNull()
  })

  it('detecta una cabecera fija', () => {
    const src = page(1000)
    const a = rowSignature(frame(src, 0, 40))
    const b = rowSignature(frame(src, 90, 40))
    expect(staticBands(a, b, H, 128)).toEqual({ top: 40, bottom: 0 })
  })
})

describe('findOffset', () => {
  it.each([37, 90, 150])('encuentra un desplazamiento de %i px', (dy) => {
    const src = page(1000, dy)
    const fa = frame(src, 0)
    const fb = frame(src, dy)
    const a = rowSignature(fa)
    const b = rowSignature(fb)
    const m = findOffset(a, b, H, 128, { top: 0, bottom: 0 }, 0, { fa, fb })
    expect(m?.dy).toBe(dy)
  })

  it('ignora la cabecera fija al alinear', () => {
    const src = page(1000, 7)
    const fa = frame(src, 0, 50)
    const fb = frame(src, 120, 50)
    const a = rowSignature(fa)
    const b = rowSignature(fb)
    const bands = staticBands(a, b, H, 128)!
    expect(findOffset(a, b, H, 128, bands, 0, { fa, fb })?.dy).toBe(120)
  })

  it('devuelve null en una zona lisa sin textura', () => {
    const flat: Frame = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(200) }
    const s = rowSignature(flat)
    expect(findOffset(s, s, H, 128, { top: 0, bottom: 0 })).toBeNull()
  })
})
