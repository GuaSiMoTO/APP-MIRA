import { describe, expect, it } from 'vitest'
import { bgLayout, type Background } from '../src/renderer/editor/effects'
import { mapPoint } from '../src/renderer/editor/transform'

const bg = (o: Partial<Background> = {}): Background => ({
  enabled: true,
  kind: 'gradient',
  colors: ['#000', '#fff'],
  image: null,
  padding: 40,
  radius: 12,
  shadow: true,
  align: 'c',
  ratio: 'auto',
  balance: false,
  ...o
})

describe('bgLayout', () => {
  it('añade el margen alrededor y centra la captura', () => {
    expect(bgLayout(400, 300, bg(), 1)).toEqual({ W: 480, H: 380, x: 40, y: 40 })
  })

  it('escala el margen con la unidad (pantallas con zoom)', () => {
    expect(bgLayout(400, 300, bg(), 2)).toEqual({ W: 560, H: 460, x: 80, y: 80 })
  })

  it('ajusta a la proporción pedida', () => {
    const l = bgLayout(400, 300, bg({ ratio: '16:9' }), 1)
    expect(l.W / l.H).toBeCloseTo(16 / 9, 2)
    expect(l.H).toBe(380) // crece el ancho, no el alto
    expect(l.x).toBe(Math.round(40 + (l.W - 480) / 2))
  })

  it('respeta la alineación dentro del espacio sobrante', () => {
    const tl = bgLayout(400, 300, bg({ ratio: '1:1', align: 'tl' }), 1)
    const br = bgLayout(400, 300, bg({ ratio: '1:1', align: 'br' }), 1)
    expect(tl).toMatchObject({ W: 480, H: 480, x: 40, y: 40 })
    expect(br).toMatchObject({ W: 480, H: 480, x: 40, y: 140 })
  })
})

describe('mapPoint', () => {
  const W = 400
  const H = 300

  it('girar a la derecha lleva la esquina superior izquierda a la superior derecha', () => {
    expect(mapPoint({ x: 0, y: 0 }, 'rotR', W, H)).toEqual({ x: H, y: 0 })
  })

  it('girar a la izquierda y a la derecha se anulan', () => {
    const p = { x: 123, y: 45 }
    const r = mapPoint(p, 'rotR', W, H)
    expect(mapPoint(r, 'rotL', H, W)).toEqual(p)
  })

  it('voltear dos veces deja el punto igual', () => {
    const p = { x: 10, y: 20 }
    expect(mapPoint(mapPoint(p, 'flipH', W, H), 'flipH', W, H)).toEqual(p)
    expect(mapPoint(mapPoint(p, 'flipV', W, H), 'flipV', W, H)).toEqual(p)
  })
})
