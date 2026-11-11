// Comprobaciones pequeñas para los datos que llegan de las ventanas por IPC o se leen de disco.
import type { Rect } from '../shared/types'

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isStr = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.length <= max
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

export function oneOf<T extends string | number>(list: readonly T[]) {
  return (v: unknown): v is T => (list as readonly unknown[]).includes(v)
}

export const isRect = (v: unknown): v is Rect =>
  isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height) && v.width >= 0 && v.height >= 0

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Bytes enviados por una ventana (ArrayBuffer o Uint8Array) como Buffer, sin copiar; null si no lo son. */
export function toBuffer(v: unknown): Buffer | null {
  if (v instanceof ArrayBuffer) return Buffer.from(v)
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  return null
}
