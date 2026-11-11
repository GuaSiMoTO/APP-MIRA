import { describe, expect, it } from 'vitest'
import { constrain, edgeProfiles, simplify, snapTo, textBandAt } from '../src/renderer/editor/analysis'
import { cropRatioValue, isLight } from '../src/renderer/editor/config'
import { effectiveColorTarget, removeHtml, shapeHtml, textHtml } from '../src/renderer/editor/ctxbar'

/** Lienzo falso: solo lo que usan las funciones de análisis (getImageData). */
function fakeCanvas(w: number, h: number, lum: (x: number, y: number) => number): HTMLCanvasElement {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = lum(x, y)
      data.set([v, v, v, 255], (y * w + x) * 4)
    }
  const ctx = {
    getImageData: (x0: number, y0: number, cw: number, ch: number) => {
      const out = new Uint8ClampedArray(cw * ch * 4)
      for (let y = 0; y < ch; y++) out.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4)
      return { data: out }
    }
  }
  return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement
}

describe('geometría del dibujo', () => {
  it('constrain: sin Mayús no cambia; con Mayús hace cuadrados y ángulos de 45°', () => {
    const s = { x: 0, y: 0 }
    expect(constrain(s, { x: 10, y: 3 }, false, 'box')).toEqual({ x: 10, y: 3 })
    expect(constrain(s, { x: 10, y: -3 }, true, 'box')).toEqual({ x: 10, y: -10 })
    const p = constrain(s, { x: 10, y: 1 }, true, 'angle')
    expect(p.x).toBeCloseTo(Math.hypot(10, 1))
    expect(p.y).toBeCloseTo(0)
  })

  it('simplify: quita los puntos alineados y conserva las esquinas', () => {
    const line = [0, 0, 1, 0.1, 2, -0.1, 3, 0, 4, 0]
    expect(simplify(line, 0.5)).toEqual([0, 0, 4, 0])
    const corner = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10]
    expect(simplify(corner, 0.5)).toEqual([0, 0, 10, 0, 10, 10])
  })

  it('cropRatioValue', () => {
    expect(cropRatioValue('free', 800, 600)).toBeNull()
    expect(cropRatioValue('orig', 800, 600)).toBeCloseTo(4 / 3)
    expect(cropRatioValue('16:9', 1, 1)).toBeCloseTo(16 / 9)
  })

  it('isLight', () => {
    expect(isLight('#ffffff')).toBe(true)
    expect(isLight('#ffd60a')).toBe(true)
    expect(isLight('#111114')).toBe(false)
  })
})

describe('análisis de la imagen', () => {
  it('el recorte se pega a un borde cercano y no a uno lejano', () => {
    // Mitad izquierda negra, derecha blanca: borde vertical en x = 50
    const c = fakeCanvas(100, 40, (x) => (x < 50 ? 0 : 255))
    const { col } = edgeProfiles(c)
    expect(snapTo(46, col, 6)).toBe(50)
    expect(snapTo(30, col, 6)).toBe(30)
  })

  it('el resaltador encuentra la altura de una línea de texto', () => {
    // Fondo blanco con una franja "de texto" (rayas negras) entre y = 40 y y = 51
    const c = fakeCanvas(200, 120, (x, y) => (y >= 40 && y <= 51 && x % 4 === 0 ? 0 : 255))
    expect(textBandAt(c, 100, 45)).toEqual({ top: 40, bottom: 51 })
    // Cerca de la línea (±12 px) también la encuentra; lejos, no
    expect(textBandAt(c, 100, 58)).toEqual({ top: 40, bottom: 51 })
    expect(textBandAt(c, 100, 100)).toBeNull()
  })
})

describe('barra contextual', () => {
  it('effectiveColorTarget corrige el destino según el modo', () => {
    expect(effectiveColorTarget('stroke', 'fill')).toBe('stroke')
    expect(effectiveColorTarget('fill', 'stroke')).toBe('fill')
    expect(effectiveColorTarget('both', 'fill')).toBe('fill')
  })

  it('shapeHtml: flecha con estilos y opción desactivada según el modo', () => {
    const html = shapeHtml({ kind: 'arrow', mode: 'stroke', colorTarget: 'stroke', color: '#ff3b5c', fillColor: '#2f8cff', arrowStyle: 'bold' })
    expect(html).toContain('data-astyle="bold" class="active"')
    expect(html).toContain('Punta hueca')
    expect(html).toMatch(/data-target="fill" class="" disabled/)
    const rect = shapeHtml({ kind: 'rect', mode: 'both', colorTarget: 'fill', color: '#000', fillColor: '#fff', arrowStyle: 'standard' })
    expect(rect).not.toContain('data-astyle')
    expect(rect).toContain('data-target="fill" class="active"')
  })

  it('textHtml muestra la colita solo en el bocadillo', () => {
    expect(textHtml('', 'plain', 'down')).not.toContain('data-dir')
    expect(textHtml('', 'bubble', 'left')).toContain('data-dir="left" class="active"')
  })

  it('removeHtml: color plano automático o elegido', () => {
    expect(removeHtml('pista', 'texture', null)).toContain('pista')
    expect(removeHtml('', 'solid', null)).toContain('automático')
    expect(removeHtml('', 'solid', '#123456')).toContain('--c:#123456')
  })
})
