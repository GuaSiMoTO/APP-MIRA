// Detección de datos sensibles en el texto reconocido por OCR (censura automática).
import type { OcrLine } from '../../shared/types'
import type { IRect } from './effects'

export type SensitiveKind = 'email' | 'phone' | 'card' | 'iban' | 'dni' | 'ip'

export interface SensitiveHit {
  kind: SensitiveKind
  text: string
  rect: IRect
}

export const KIND_LABELS: Record<SensitiveKind, [string, string]> = {
  email: ['correo', 'correos'],
  phone: ['teléfono', 'teléfonos'],
  card: ['tarjeta', 'tarjetas'],
  iban: ['IBAN', 'IBAN'],
  dni: ['DNI/NIE', 'DNI/NIE'],
  ip: ['IP', 'IP']
}

const digits = (s: string) => s.replace(/\D/g, '')

function luhn(num: string): boolean {
  let sum = 0
  let alt = false
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i])
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (s.length < 15 || s.length > 34) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

function dniValid(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase()
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s)
  if (!m) return false
  const prefix = { '': '', X: '0', Y: '1', Z: '2' }[m[1] as '' | 'X' | 'Y' | 'Z']
  const n = Number(prefix + m[2])
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23] === m[3]
}

interface Rule {
  kind: SensitiveKind
  re: RegExp
  ok?: (m: string) => boolean
}

// Orden importante: lo más específico primero (una tarjeta no debe tomarse por teléfono)
const RULES: Rule[] = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, ok: ibanValid },
  {
    kind: 'card',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    ok: (m) => {
      const d = digits(m)
      // Se descartan secuencias de un único dígito repetido (0000 0000 …), que pasan Luhn
      return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d)
    }
  },
  { kind: 'dni', re: /\b[XYZ]?[ -]?\d{7,8}[ -]?[A-Z]\b/gi, ok: dniValid },
  { kind: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  {
    kind: 'phone',
    re: /(?:\+|00)\d{1,3}[ .-]?(?:\(?\d{1,4}\)?[ .-]?){2,5}\d{2,4}|\b[6789]\d{2}[ .-]?\d{2,3}[ .-]?\d{2,3}[ .-]?\d{0,3}\b/g,
    ok: (m) => {
      const n = digits(m).length
      return n >= 9 && n <= 15
    }
  }
]

/**
 * El OCR confunde a veces dígitos con letras (0↔O, 1↔l/I/|). En palabras que son casi
 * todo números se corrigen para que las tarjetas, teléfonos o DNI se detecten igual.
 * Se sustituye carácter a carácter, así que las posiciones no cambian.
 */
function normalizeDigits(word: string): string {
  const core = word.replace(/[.,:;]$/, '')
  if (core.length < 3 || !/\d/.test(core) || !/^[0-9OoIl|]+$/.test(core)) return word
  return word.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1')
}

/** Busca datos sensibles línea a línea y devuelve el rectángulo (en px de la imagen) de cada uno. */
export function findSensitive(lines: OcrLine[], pad = 3): SensitiveHit[] {
  const hits: SensitiveHit[] = []
  for (const line of lines) {
    if (!line.words.length) continue
    // Texto de la línea con la posición de cada palabra
    let text = ''
    const spans: Array<{ start: number; end: number; i: number }> = []
    line.words.forEach((w, i) => {
      if (text) text += ' '
      spans.push({ start: text.length, end: text.length + w.text.length, i })
      text += normalizeDigits(w.text)
    })
    const taken: Array<[number, number]> = []
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.re.exec(text))) {
        const s = m.index
        const e = s + m[0].length
        if (rule.ok && !rule.ok(m[0])) continue
        if (taken.some(([a, b]) => s < b && e > a)) continue
        taken.push([s, e])
        const words = spans.filter((sp) => sp.start < e && sp.end > s).map((sp) => line.words[sp.i])
        if (!words.length) continue
        const x0 = Math.min(...words.map((w) => w.x)) - pad
        const y0 = Math.min(...words.map((w) => w.y)) - pad
        const x1 = Math.max(...words.map((w) => w.x + w.w)) + pad
        const y1 = Math.max(...words.map((w) => w.y + w.h)) + pad
        hits.push({ kind: rule.kind, text: m[0], rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
      }
    }
  }
  return hits
}

/** "2 correos, 1 teléfono" */
export function summarize(hits: SensitiveHit[]): string {
  const count = new Map<SensitiveKind, number>()
  for (const h of hits) count.set(h.kind, (count.get(h.kind) ?? 0) + 1)
  return [...count].map(([k, n]) => `${n} ${KIND_LABELS[k][n === 1 ? 0 : 1]}`).join(', ')
}
