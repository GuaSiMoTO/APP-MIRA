// Detecta clics y teclas durante una grabación consultando GetAsyncKeyState (~60 Hz).
// Solo se activa mientras se graba y con las opciones "Clics"/"Teclas" encendidas.
import { screen } from 'electron'
import type { InputEvent } from '../shared/types'
import { isKeyDown, keyState } from './winapi'

const VK_LBUTTON = 0x01
const VK_RBUTTON = 0x02
const VK_MBUTTON = 0x04
const MODS = { ctrl: [0x11], alt: [0x12], shift: [0x10], win: [0x5b, 0x5c] }
const MOD_CODES = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5])

const NAMES: Record<number, string> = {
  0x08: '⌫',
  0x09: 'Tab',
  0x0d: 'Intro',
  0x1b: 'Esc',
  0x20: 'Espacio',
  0x21: 'RePág',
  0x22: 'AvPág',
  0x23: 'Fin',
  0x24: 'Inicio',
  0x25: '←',
  0x26: '↑',
  0x27: '→',
  0x28: '↓',
  0x2c: 'ImprPant',
  0x2d: 'Insert',
  0x2e: 'Supr',
  0xba: 'ñ',
  0xbb: '+',
  0xbc: ',',
  0xbd: '-',
  0xbe: '.',
  0xbf: 'ç',
  0xc0: 'ñ',
  0xde: '´'
}

function keyName(vk: number): string | null {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk) // A-Z
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk) // 0-9
  if (vk >= 0x60 && vk <= 0x69) return String(vk - 0x60) // teclado numérico
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`
  return NAMES[vk] ?? null
}

/** Códigos que se consultan: teclas con nombre (evita los botones del ratón y los modificadores). */
const KEYS: number[] = []
for (let vk = 0x08; vk <= 0xde; vk++) if (!MOD_CODES.has(vk) && keyName(vk)) KEYS.push(vk)

interface Region {
  /** Origen de la región en coordenadas físicas de pantalla */
  x: number
  y: number
  width: number
  height: number
}

let timer: NodeJS.Timeout | null = null

export function startInputHook(region: Region, opts: { clicks: boolean; keys: boolean }, emit: (e: InputEvent) => void): void {
  stopInputHook()
  const prev = new Map<number, boolean>()
  // Primer sondeo: se descartan pulsaciones anteriores a la grabación
  for (const vk of [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, ...KEYS]) prev.set(vk, keyState(vk).down)
  const down = (vk: number) => {
    const s = keyState(vk)
    const was = prev.get(vk) ?? s.down
    prev.set(vk, s.down)
    // Flanco de bajada, o una pulsación tan rápida que ocurrió entre dos sondeos
    return (s.down && !was) || (s.pressed && !s.down)
  }
  const held = (codes: number[]) => codes.some((c) => isKeyDown(c))

  timer = setInterval(() => {
    if (opts.clicks) {
      for (const [vk, button] of [
        [VK_LBUTTON, 'left'],
        [VK_RBUTTON, 'right'],
        [VK_MBUTTON, 'middle']
      ] as const) {
        if (!down(vk)) continue
        const p = screen.dipToScreenPoint(screen.getCursorScreenPoint())
        const x = p.x - region.x
        const y = p.y - region.y
        if (x >= 0 && y >= 0 && x < region.width && y < region.height) emit({ type: 'click', x, y, button })
      }
    }
    if (opts.keys) {
      const ctrl = held(MODS.ctrl)
      const alt = held(MODS.alt)
      const win = held(MODS.win)
      const shift = held(MODS.shift)
      for (const vk of KEYS) {
        if (!down(vk)) continue
        const name = keyName(vk)!
        const combo = ctrl || alt || win
        const special = name.length > 1 // Intro, Esc, F5, flechas…
        if (combo || (special && shift)) {
          const parts = [ctrl && 'Ctrl', alt && 'Alt', win && 'Win', shift && 'Mayús', name].filter(Boolean)
          emit({ type: 'key', label: parts.join(' + '), combo: true })
        } else if (special) {
          emit({ type: 'key', label: name, combo: true })
        } else {
          // Escritura normal: se agrupa en el vídeo como texto
          emit({ type: 'key', label: shift ? name : name.toLowerCase(), combo: false })
        }
      }
    }
  }, 16)
}

export function stopInputHook(): void {
  if (timer) clearInterval(timer)
  timer = null
}
