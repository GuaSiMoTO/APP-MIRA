// Enumeración de ventanas visibles mediante la API Win32 (koffi), para el modo "Ventana".
import type { Rect } from '../shared/types'
import { logError } from './log'

export interface NativeWindow extends Rect {
  title: string
  handle: bigint
}

type Api = {
  enumerate: () => NativeWindow[]
}

let api: Api | null | undefined

function load(): Api | null {
  if (process.platform !== 'win32') return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')

  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)')

  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)')
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)')
  const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)')
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)')
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)')
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)')
  const DwmGetRect = dwmapi.func(
    'long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ RECT *pv, uint32_t cb)'
  )
  const DwmGetInt = dwmapi.func(
    'long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ int *pv, uint32_t cb)'
  )

  const GWL_EXSTYLE = -20
  const WS_EX_TOOLWINDOW = 0x80
  const WS_EX_NOACTIVATE = 0x08000000
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9
  const DWMWA_CLOAKED = 14

  let found: NativeWindow[] = []

  const callback = (hwnd: unknown): boolean => {
    try {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
      if (ex & WS_EX_TOOLWINDOW || ex & WS_EX_NOACTIVATE) return true
      const cloaked = [0]
      if (DwmGetInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true

      const buf = new Uint16Array(512)
      const len = GetWindowTextW(hwnd, buf, 512)
      const title = String.fromCharCode(...buf.subarray(0, len))
      if (!title || title === 'Program Manager') return true

      const r: Record<string, number> = {}
      // Los límites de DWM excluyen la sombra invisible de Windows 10/11
      if (DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) GetWindowRect(hwnd, r)
      const width = r.right - r.left
      const height = r.bottom - r.top
      if (width < 20 || height < 20) return true
      found.push({ x: r.left, y: r.top, width, height, title, handle: koffi.address(hwnd) })
    } catch {
      /* se ignora la ventana problemática */
    }
    return true
  }

  const cbPtr = koffi.register(callback, koffi.pointer(EnumWindowsProc))

  return {
    enumerate() {
      found = []
      EnumWindows(cbPtr, 0)
      return found
    }
  }
}

/** Ventanas visibles de nivel superior en píxeles físicos, ordenadas de delante hacia atrás. */
export function listWindows(): NativeWindow[] {
  try {
    if (api === undefined) api = load()
    return api ? api.enumerate() : []
  } catch (err) {
    logError('No se pudieron enumerar las ventanas', err)
    api = null
    return []
  }
}

// ---------- Entrada: cursor, rueda y estado de teclas ----------

interface InputApi {
  setCursorPos: (x: number, y: number) => boolean
  wheel: (delta: number) => void
  keyDown: (vk: number) => boolean
  keyState: (vk: number) => number
}

let input: InputApi | null | undefined

function loadInput(): InputApi | null {
  if (process.platform !== 'win32') return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)')
  const mouse_event = user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, int32_t data, uintptr_t extra)')
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)')
  const MOUSEEVENTF_WHEEL = 0x0800
  return {
    setCursorPos: (x, y) => SetCursorPos(Math.round(x), Math.round(y)),
    wheel: (delta) => mouse_event(MOUSEEVENTF_WHEEL, 0, 0, Math.round(delta), 0),
    keyDown: (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0,
    keyState: (vk) => GetAsyncKeyState(vk) & 0xffff
  }
}

function inputApi(): InputApi | null {
  try {
    if (input === undefined) input = loadInput()
    return input
  } catch (err) {
    logError('No se pudo cargar la API de entrada', err)
    input = null
    return null
  }
}

/** Mueve el cursor (coordenadas físicas de pantalla). */
export function setCursorPos(x: number, y: number): boolean {
  return inputApi()?.setCursorPos(x, y) ?? false
}

/** Gira la rueda del ratón: negativo = hacia abajo (120 = una muesca). */
export function sendWheel(delta: number): void {
  inputApi()?.wheel(delta)
}

/** Estado de una tecla: { down: pulsada ahora, pressed: se pulsó desde la consulta anterior }. */
export function keyState(vk: number): { down: boolean; pressed: boolean } {
  const s = inputApi()?.keyState(vk) ?? 0
  return { down: (s & 0x8000) !== 0, pressed: (s & 1) !== 0 }
}

/** ¿Está pulsada ahora mismo la tecla o botón virtual `vk`? */
export function isKeyDown(vk: number): boolean {
  return inputApi()?.keyDown(vk) ?? false
}
