import { describe, expect, it } from 'vitest'
import type { OcrLine } from '../src/shared/types'
import { findSensitive, summarize } from '../src/renderer/editor/sensitive'

/** Línea de OCR con palabras de 10 px de ancho por carácter, separadas 10 px. */
function line(text: string, y = 0): OcrLine {
  let x = 0
  const words = text.split(' ').map((t) => {
    const w = { text: t, x, y, w: t.length * 10, h: 20 }
    x += w.w + 10
    return w
  })
  return { text, words }
}

const kinds = (text: string) => findSensitive([line(text)]).map((h) => h.kind)

describe('findSensitive', () => {
  it('detecta correos', () => {
    expect(kinds('Escribe a lucia.martin@ejemplo.com hoy')).toEqual(['email'])
  })

  it('detecta tarjetas válidas (Luhn) y descarta las que no lo son', () => {
    expect(kinds('Tarjeta 4111 1111 1111 1111')).toEqual(['card'])
    expect(kinds('Tarjeta 4111 1111 1111 1112')).not.toContain('card')
  })

  it('no toma por tarjeta un único dígito repetido', () => {
    expect(kinds('0000 0000 0000 0000')).not.toContain('card')
  })

  it('detecta IBAN con dígito de control correcto', () => {
    expect(kinds('IBAN ES91 2100 0418 4502 0005 1332')).toEqual(['iban'])
    expect(kinds('IBAN ES00 2100 0418 4502 0005 1332')).not.toContain('iban')
  })

  it('detecta DNI y NIE con letra correcta', () => {
    expect(kinds('DNI 12345678Z')).toEqual(['dni'])
    expect(kinds('NIE X1234567L')).toEqual(['dni'])
    expect(kinds('DNI 12345678A')).not.toContain('dni')
  })

  it('detecta teléfonos españoles e internacionales', () => {
    expect(kinds('Llama al 612 345 678')).toEqual(['phone'])
    expect(kinds('Tel. +34 612 345 678')).toEqual(['phone'])
  })

  it('detecta direcciones IP', () => {
    expect(kinds('Servidor 192.168.1.20 caído')).toEqual(['ip'])
    expect(kinds('Versión 300.1.1.1')).not.toContain('ip')
  })

  it('una tarjeta no se cuenta también como teléfono', () => {
    expect(kinds('4111 1111 1111 1111')).toEqual(['card'])
  })

  it('corrige O→0 y l→1 en palabras numéricas del OCR', () => {
    expect(kinds('4111 1l11 1111 1111')).toEqual(['card'])
    expect(kinds('6l2 345 678')).toEqual(['phone'])
    expect(kinds('DNI 1234567B Z')).not.toContain('dni')
  })

  it('no «corrige» palabras sin ningún dígito', () => {
    expect(kinds('Hola lOl IIl')).toEqual([])
  })

  it('no toca palabras normales', () => {
    expect(kinds('Hola, esto es un texto sin datos')).toEqual([])
  })

  it('devuelve el rectángulo de las palabras con margen', () => {
    const [hit] = findSensitive([line('correo a@b.es', 100)], 3)
    // «a@b.es» empieza en x = 70 (6 letras + 10 px) y mide 60 px
    expect(hit.rect).toEqual({ x: 67, y: 97, width: 66, height: 26 })
  })
})

describe('summarize', () => {
  it('cuenta por tipo con singular y plural', () => {
    const hits = findSensitive([line('a@b.es c@d.es 612 345 678')])
    expect(summarize(hits)).toBe('2 correos, 1 teléfono')
  })
})
