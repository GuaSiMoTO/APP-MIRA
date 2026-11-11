// Herramientas, paletas y tipos del editor (datos fijos, sin estado).
import type { IconName } from '../shared/icons'

export type Tool =
  | 'select'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'counter'
  | 'pixelate'
  | 'blur'
  | 'erase'
  | 'remove'
  | 'crop'
  | 'spotlight'
  | 'magnifier'

export const TOOLS: Array<{ id: Tool; icon: IconName; label: string; key: string; hint: string }> = [
  { id: 'select', icon: 'select', label: 'Seleccionar', key: 'v', hint: 'Haz clic en un elemento para moverlo o redimensionarlo · Supr lo elimina' },
  { id: 'arrow', icon: 'arrow', label: 'Flecha', key: 'a', hint: 'Arrastra para dibujar una flecha · Mayús ajusta a 45°' },
  { id: 'rect', icon: 'rect', label: 'Rectángulo', key: 'r', hint: 'Arrastra para dibujar un rectángulo · Mayús hace un cuadrado' },
  { id: 'ellipse', icon: 'ellipse', label: 'Elipse', key: 'o', hint: 'Arrastra para dibujar una elipse · Mayús hace un círculo' },
  { id: 'line', icon: 'line', label: 'Línea', key: 'l', hint: 'Arrastra para dibujar una línea · Mayús ajusta a 45°' },
  { id: 'pen', icon: 'pen', label: 'Lápiz', key: 'p', hint: 'Dibuja a mano alzada' },
  { id: 'highlighter', icon: 'highlighter', label: 'Resaltador', key: 'h', hint: 'Pasa por encima del texto: se ajusta solo a la altura de la línea · fuera del texto dibuja a mano (Mayús = recto)' },
  { id: 'text', icon: 'text', label: 'Texto', key: 't', hint: 'Haz clic para escribir (el bocadillo apunta donde hagas clic) · Ctrl+Intro o clic fuera para terminar' },
  { id: 'counter', icon: 'counter', label: 'Contador', key: 'n', hint: 'Haz clic para añadir pasos numerados' },
  { id: 'pixelate', icon: 'pixelate', label: 'Pixelar', key: 'x', hint: 'Arrastra sobre información sensible para pixelarla' },
  { id: 'blur', icon: 'blur', label: 'Desenfocar', key: 'b', hint: 'Arrastra para desenfocar una zona · desenfoque seguro: no se puede revertir en la imagen exportada' },
  { id: 'erase', icon: 'eraser', label: 'Goma (borrar anotaciones)', key: 'g', hint: 'Pasa la goma por encima de las anotaciones para borrarlas' },
  { id: 'remove', icon: 'remove', label: 'Quitar objeto de la imagen', key: 'q', hint: 'Arrastra sobre un elemento de la captura para quitarlo y rellenar con el fondo' },
  { id: 'crop', icon: 'crop', label: 'Recortar', key: 'c', hint: 'Arrastra para elegir el área · Intro aplica · Esc cancela' },
  { id: 'spotlight', icon: 'spotlight', label: 'Foco', key: 'f', hint: 'Arrastra sobre lo importante: el resto se oscurece · puedes añadir varios focos' },
  { id: 'magnifier', icon: 'magnifier', label: 'Lupa', key: 'm', hint: 'Arrastra desde el centro para ampliar un detalle · después se puede mover y redimensionar' }
]

export const toolDef = (id: Tool) => TOOLS.find((x) => x.id === id)!

// Barra de herramientas: las parecidas se agrupan en un botón con menú (recuerda la última usada)
export interface ToolGroup {
  id: string
  label: string
  tools: Tool[]
}
export const TOOLBAR: Array<Tool | ToolGroup> = [
  'select',
  'arrow',
  { id: 'shapes', label: 'Formas', tools: ['rect', 'ellipse', 'line'] },
  { id: 'draw', label: 'Dibujo', tools: ['pen', 'highlighter'] },
  'text',
  'counter',
  { id: 'hide', label: 'Ocultar', tools: ['pixelate', 'blur'] },
  { id: 'focus', label: 'Destacar', tools: ['spotlight', 'magnifier'] },
  'erase',
  'remove',
  'crop'
]

export const COLORS = ['#ff3b5c', '#ff8a1f', '#ffd60a', '#2fd36b', '#2f8cff', '#a45cff', '#ffffff', '#111114']
export const SIZES = [3, 5, 9]
export const FONT_SIZES = [18, 26, 40]
export const COUNTER_R = [12, 16, 22]

export const BACKGROUNDS: Array<{ kind: 'gradient' | 'solid'; colors: [string, string] }> = [
  ...([
    ['#ff9a8b', '#ff5f8f'],
    ['#5ea8ff', '#6d5cff'],
    ['#43e0a0', '#2bb5d9'],
    ['#ffb347', '#ff6f61'],
    ['#c3a6ff', '#ff9ad5'],
    ['#2d3a8c', '#18a5c9'],
    ['#3a3d45', '#16171b'],
    ['#f4f4f6', '#dcdce2'],
    ['#fbd786', '#f7797d'],
    ['#a1ffce', '#faffd1'],
    ['#0f2027', '#2c5364'],
    ['#ee9ca7', '#ffdde1'],
    ['#7f7fd5', '#91eae4'],
    ['#ff512f', '#dd2476']
  ] as Array<[string, string]>).map((colors) => ({ kind: 'gradient' as const, colors })),
  ...['#ffffff', '#f1f3f7', '#1e1f24', '#2f6bff', '#ffd23f', '#18b38a'].map((c) => ({ kind: 'solid' as const, colors: [c, c] as [string, string] }))
]

export const RESIZABLE = ['rect', 'ellipse', 'effect', 'text', 'label', 'spotlight', 'magnifier']
export const TEXTUAL = ['text', 'label']

// Borde y relleno de rectángulos, elipses y flechas
export type PaintMode = 'stroke' | 'fill' | 'both'
export type Fillable = 'rect' | 'ellipse' | 'arrow'
export const FILLABLE: Fillable[] = ['rect', 'ellipse', 'arrow']

// Texto: simple, con fondo o bocadillo (y hacia dónde apunta la colita)
export type TextStyle = 'plain' | 'outline' | 'shadow' | 'label' | 'translucent' | 'bubble' | 'pill'
/** Estilos que son texto suelto (sin fondo) */
export const PLAIN_STYLES: TextStyle[] = ['plain', 'outline', 'shadow']
export type BubbleDir = 'down' | 'up' | 'left' | 'right'

// Flecha: normal, fina, gruesa o doble punta
export type ArrowStyle = 'standard' | 'thin' | 'bold' | 'double'

export type CropRatio = 'free' | 'orig' | '1:1' | '4:3' | '16:9' | '9:16'

/** Proporción ancho/alto del recorte (null = libre). */
export function cropRatioValue(r: CropRatio, width: number, height: number): number | null {
  if (r === 'free') return null
  if (r === 'orig') return width / height
  const [a, b] = r.split(':').map(Number)
  return a / b
}

/** ¿Color claro? (para elegir texto negro o blanco encima) */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = n >> 16
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 170
}
