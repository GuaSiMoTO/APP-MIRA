// Fondo decorativo y favoritos guardados en localStorage (por si no hay almacenamiento, nunca lanza).
import { BACKGROUNDS } from './config'
import type { Background } from './effects'

const BG_KEY = 'editor-bg'
const PRESETS_KEY = 'editor-bg-presets'

export function loadBg(): Background {
  const def: Background = { enabled: false, kind: 'gradient', colors: BACKGROUNDS[1].colors, image: null, padding: 64, radius: 12, shadow: true, align: 'c', ratio: 'auto', balance: false }
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(BG_KEY) ?? '{}') }
  } catch {
    return def
  }
}

export function saveBg(bg: Background): void {
  try {
    localStorage.setItem(BG_KEY, JSON.stringify(bg))
  } catch {
    /* sin almacenamiento */
  }
}

export function loadPresets(): Background[] {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]')
    return Array.isArray(p) ? (p as Background[]) : []
  } catch {
    return []
  }
}

/** Devuelve false si no cabe (las imágenes de fondo ocupan mucho). */
export function savePresets(p: Background[]): boolean {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p))
    return true
  } catch {
    return false
  }
}
