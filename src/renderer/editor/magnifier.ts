// Lupa: círculo con lo que hay debajo ampliado, borde blanco y sombra.
import { canvasOf } from './effects'

/** Margen alrededor del círculo para la sombra. */
export const magPad = (unit: number) => 10 * unit

/** Lienzo de la lupa centrada en (cx, cy) de `src`, con radio r y aumento z. */
export function magnifierCanvas(src: HTMLCanvasElement, cx: number, cy: number, r: number, z: number, unit: number): HTMLCanvasElement {
  const pad = magPad(unit)
  const size = Math.ceil(2 * r + 2 * pad)
  const c = canvasOf(size, size)
  const ctx = c.getContext('2d')!
  const m = size / 2
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 8 * unit
  ctx.shadowOffsetY = 2 * unit
  ctx.beginPath()
  ctx.arc(m, m, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(m, m, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingQuality = 'high'
  const sr = r / z
  ctx.drawImage(src, cx - sr, cy - sr, 2 * sr, 2 * sr, m - r, m - r, 2 * r, 2 * r)
  ctx.restore()
  ctx.lineWidth = 3 * unit
  ctx.strokeStyle = '#fff'
  ctx.beginPath()
  ctx.arc(m, m, r - 1.5 * unit, 0, Math.PI * 2)
  ctx.stroke()
  return c
}
