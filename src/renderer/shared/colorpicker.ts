// Selector de color reutilizable: saturación/brillo + tono, HEX, R G B, cuentagotas y colores recientes.
import { icons } from './icons'

export type ColorCallback = (hex: string, done: boolean) => void

const RECENT_KEY = 'color-recent'

// ---------- Conversión de colores ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

export const isValidHex = (s: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim())
export const normalizeHex = (s: string) => {
  const h = s.trim().replace('#', '')
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toLowerCase()
}

// ---------- Cuentagotas (cualquier punto de la pantalla) ----------

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
export const hasEyeDropper = () => typeof (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper === 'function'

/** Abre el cuentagotas del sistema: se puede elegir un color de cualquier sitio de la pantalla. */
export async function pickScreenColor(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  if (!Ctor) return null
  try {
    const r = await new Ctor().open()
    return normalizeHex(r.sRGBHex)
  } catch {
    return null // cancelado con Esc
  }
}

// ---------- Colores recientes ----------

export function recentColors(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function addRecentColor(hex: string): void {
  try {
    const list = [hex, ...recentColors().filter((c) => c !== hex)].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* sin almacenamiento */
  }
}

// ---------- Panel ----------

let current: { el: HTMLElement; close: () => void } | null = null

export function closeColorPicker(): void {
  current?.close()
}

/**
 * Abre el selector junto a `anchor`. `onChange(hex, false)` se llama mientras se ajusta
 * (vista previa) y `onChange(hex, true)` al terminar (soltar, escribir un valor, cuentagotas…).
 */
export function openColorPicker(anchor: HTMLElement, initial: string, onChange: ColorCallback, title = 'Color'): void {
  closeColorPicker()
  let [h, s, v] = rgbToHsv(...hexToRgb(initial))
  let hex = normalizeHex(initial)

  const el = document.createElement('div')
  el.className = 'cpick'
  el.innerHTML = `
    <div class="cp-head"><span>${title}</span><button class="cp-x" title="Cerrar (Esc)">${icons.close}</button></div>
    <div class="cp-sv"><canvas width="232" height="150"></canvas><i class="cp-dot"></i></div>
    <div class="cp-row">
      <i class="cp-preview"></i>
      <input class="cp-hue" type="range" min="0" max="360" step="1" aria-label="Tono" />
      ${hasEyeDropper() ? `<button class="cp-eye" title="Cuentagotas: elige un color de cualquier sitio de la pantalla">${icons.eyedropper}</button>` : ''}
    </div>
    <div class="cp-fields">
      <label>HEX<input class="cp-hex" maxlength="7" spellcheck="false" /></label>
      <label>R<input class="cp-c" data-i="0" type="number" min="0" max="255" /></label>
      <label>G<input class="cp-c" data-i="1" type="number" min="0" max="255" /></label>
      <label>B<input class="cp-c" data-i="2" type="number" min="0" max="255" /></label>
    </div>
    <div class="cp-recent"></div>`
  document.body.appendChild(el)

  const canvas = el.querySelector('canvas')!
  const ctx = canvas.getContext('2d')!
  const dot = el.querySelector<HTMLElement>('.cp-dot')!
  const hue = el.querySelector<HTMLInputElement>('.cp-hue')!
  const hexIn = el.querySelector<HTMLInputElement>('.cp-hex')!
  const rgbIn = [...el.querySelectorAll<HTMLInputElement>('.cp-c')]
  const preview = el.querySelector<HTMLElement>('.cp-preview')!

  const paintSV = () => {
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = `hsl(${h}, 100%, 50%)`
    ctx.fillRect(0, 0, W, H)
    const white = ctx.createLinearGradient(0, 0, W, 0)
    white.addColorStop(0, '#fff')
    white.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = white
    ctx.fillRect(0, 0, W, H)
    const black = ctx.createLinearGradient(0, 0, 0, H)
    black.addColorStop(0, 'rgba(0,0,0,0)')
    black.addColorStop(1, '#000')
    ctx.fillStyle = black
    ctx.fillRect(0, 0, W, H)
  }

  const renderRecent = () => {
    el.querySelector('.cp-recent')!.innerHTML =
      '<span>Recientes</span>' +
      recentColors()
        .map((c) => `<button data-c="${c}" title="${c.toUpperCase()}" style="background:${c}"></button>`)
        .join('')
  }

  /** Actualiza todos los controles desde h/s/v y avisa del color. */
  const sync = (done: boolean, from?: 'hex' | 'rgb') => {
    const rgb = hsvToRgb(h, s, v)
    hex = rgbToHex(...rgb)
    if (from !== 'hex') hexIn.value = hex.toUpperCase()
    if (from !== 'rgb') rgbIn.forEach((inp, i) => (inp.value = String(Math.round(rgb[i]))))
    hue.value = String(Math.round(h))
    hue.style.setProperty('--h', String(h))
    dot.style.left = `${s * 100}%`
    dot.style.top = `${(1 - v) * 100}%`
    preview.style.background = hex
    paintSV()
    onChange(hex, done)
    if (done) {
      addRecentColor(hex)
      renderRecent()
    }
  }

  const setHex = (value: string, done: boolean, from?: 'hex' | 'rgb') => {
    ;[h, s, v] = rgbToHsv(...hexToRgb(value))
    sync(done, from)
  }

  // Cuadro de saturación/brillo
  let dragging = false
  const svAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    canvas.setPointerCapture(e.pointerId)
    svAt(e)
    sync(false)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    svAt(e)
    sync(false)
  })
  canvas.addEventListener('pointerup', () => {
    dragging = false
    sync(true)
  })
  hue.addEventListener('input', () => {
    h = Number(hue.value)
    sync(false)
  })
  hue.addEventListener('change', () => sync(true))
  hexIn.addEventListener('input', () => {
    if (isValidHex(hexIn.value)) setHex(normalizeHex(hexIn.value), false, 'hex')
  })
  hexIn.addEventListener('change', () => {
    if (isValidHex(hexIn.value)) setHex(normalizeHex(hexIn.value), true)
    else hexIn.value = hex.toUpperCase()
  })
  for (const inp of rgbIn) {
    const read = () => rgbIn.map((x) => Math.max(0, Math.min(255, Number(x.value) || 0))) as [number, number, number]
    inp.addEventListener('input', () => setHex(rgbToHex(...read()), false, 'rgb'))
    inp.addEventListener('change', () => setHex(rgbToHex(...read()), true))
  }
  el.querySelector('.cp-recent')!.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).dataset.c
    if (c) setHex(c, true)
  })
  el.querySelector('.cp-eye')?.addEventListener('click', async () => {
    const c = await pickScreenColor()
    if (c) setHex(c, true)
  })
  el.querySelector('.cp-x')!.addEventListener('click', () => close())
  el.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') close()
    if (e.key === 'Enter') (e.target as HTMLElement).blur?.()
  })

  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close()
  }
  const close = () => {
    window.removeEventListener('pointerdown', outside, true)
    el.remove()
    if (current?.el === el) current = null
  }
  window.addEventListener('pointerdown', outside, true)
  current = { el, close }

  // Posición: debajo del botón, sin salirse de la ventana
  const r = anchor.getBoundingClientRect()
  const w = el.offsetWidth
  const hgt = el.offsetHeight
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`
  el.style.top = `${r.bottom + 6 + hgt > window.innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6}px`

  renderRecent()
  sync(false)
}
