import { app } from 'electron'
import { cpSync, existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { OverlayState, Settings } from '../shared/types'
import { logError } from './log'
import { readJson, writeJsonAtomic } from './store'
import { isBool, isNum, isObj, isRect, isStr, oneOf } from './validate'

const file = () => join(app.getPath('userData'), 'settings.json')

/**
 * La app se llamaba «Capturas»: al cambiar el nombre a «Mira», la carpeta de datos cambia de
 * %APPDATA%\Capturas a %APPDATA%\Mira. La primera vez se copian los ajustes, el historial y las
 * preferencias del editor para no perder nada. Debe llamarse antes de leer ajustes o abrir ventanas.
 */
export function migrateFromOldName(): void {
  try {
    const now = app.getPath('userData')
    const old = join(app.getPath('appData'), 'Capturas')
    // Solo la primera vez: si ya hay datos de Mira (aunque settings.json se haya apartado por
    // estar dañado, el historial sigue ahí) no se vuelve a copiar nada
    if (existsSync(join(now, 'settings.json')) || existsSync(join(now, 'historial'))) return
    if (!existsSync(join(old, 'settings.json'))) return
    for (const item of ['settings.json', 'historial', 'Local Storage']) {
      const from = join(old, item)
      if (existsSync(from)) cpSync(from, join(now, item), { recursive: true, force: false, errorOnExist: false })
    }
  } catch (err) {
    logError('No se pudieron migrar los datos de «Capturas»', err)
  }
}

const defaults = (): Settings => ({
  saveDir: join(app.getPath('pictures'), 'Capturas'),
  format: 'png',
  autoCopy: true,
  autoSave: false,
  hotkey: 'Control+Shift+S',
  hotkeyRepeat: 'Alt+Shift+R',
  hotkeyText: 'Alt+Shift+T',
  launchAtLogin: false,
  lastState: { kind: 'photo', mode: 'region', delay: 0, mic: false, sysAudio: false, clicks: true, keys: false, camera: false },
  lastRegion: null,
  previewEnabled: true,
  previewPosition: 'left',
  previewSize: 'm',
  previewAutoClose: 7
})

// ---------- Validación ----------

const isKind = oneOf(['photo', 'video', 'text'] as const)
const isMode = oneOf(['region', 'window', 'screen', 'scroll'] as const)
const isDelay = oneOf([0, 3, 5, 10] as const)
const isHotkey = (v: unknown): v is string => isStr(v, 64)

/** Estado de la barra de captura: cada campo no válido toma el valor de `base`. */
export function pickState(raw: unknown, base: OverlayState): OverlayState {
  const r = isObj(raw) ? raw : {}
  const bool = (k: 'mic' | 'sysAudio' | 'clicks' | 'keys' | 'camera') => (isBool(r[k]) ? r[k] : base[k])
  return {
    kind: isKind(r.kind) ? r.kind : base.kind,
    mode: isMode(r.mode) ? r.mode : base.mode,
    delay: isDelay(r.delay) ? r.delay : base.delay,
    mic: bool('mic'),
    sysAudio: bool('sysAudio'),
    clicks: bool('clicks'),
    keys: bool('keys'),
    camera: bool('camera')
  }
}

type Checks = { [K in keyof Settings]?: (v: unknown) => boolean }
const CHECKS: Checks = {
  saveDir: (v) => isStr(v) && v.trim() !== '' && isAbsolute(v),
  format: oneOf(['png', 'jpg'] as const),
  autoCopy: isBool,
  autoSave: isBool,
  launchAtLogin: isBool,
  previewEnabled: isBool,
  hotkey: isHotkey,
  hotkeyRepeat: isHotkey,
  hotkeyText: isHotkey,
  previewPosition: oneOf(['left', 'right'] as const),
  previewSize: oneOf(['s', 'm', 'l'] as const),
  previewAutoClose: (v) => isNum(v) && v >= 0 && v <= 120,
  lastRegion: (v) => v === null || (isObj(v) && isNum(v.displayId) && isRect(v.rect))
}

/**
 * Se queda solo con los ajustes conocidos y válidos (lista blanca). Lo que llega de las
 * ventanas o de un settings.json editado a mano no puede colar claves o tipos incorrectos.
 */
export function pickSettings(raw: unknown, base: Settings = getSettings()): Partial<Settings> {
  if (!isObj(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(CHECKS)) {
    if (key in raw && check!(raw[key])) out[key] = raw[key]
  }
  if ('lastState' in raw) out.lastState = pickState(raw.lastState, base.lastState)
  return out as Partial<Settings>
}

// ---------- Lectura y escritura ----------

let current: Settings | null = null

export function getSettings(): Settings {
  if (current) return current
  const base = defaults()
  // Un ajuste dañado o no válido toma su valor por defecto sin perder los demás
  current = { ...base, ...pickSettings(readJson(file()), base) }
  return current
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  try {
    writeJsonAtomic(file(), current)
  } catch (err) {
    logError('No se pudieron guardar los ajustes', err)
  }
  return current
}
