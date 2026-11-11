export type CaptureKind = 'photo' | 'video' | 'text'
export type CaptureMode = 'region' | 'window' | 'screen' | 'scroll'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayState {
  kind: CaptureKind
  mode: CaptureMode
  delay: number
  mic: boolean
  sysAudio: boolean
  /** Vídeo: mostrar clics del ratón en la grabación */
  clicks: boolean
  /** Vídeo: mostrar las teclas pulsadas en la grabación */
  keys: boolean
  /** Vídeo: burbuja con la webcam */
  camera: boolean
}

export interface LastRegion {
  displayId: number
  /** Coordenadas locales de la pantalla (DIP) */
  rect: Rect
}

export interface OverlayInit {
  displayId: number
  /** Captura congelada de la pantalla (JPEG en bytes) */
  image: Uint8Array
  /** Ventanas visibles en coordenadas locales de esta pantalla (DIP), de delante hacia atrás */
  windows: Array<Rect & { title: string }>
  showToolbar: boolean
  state: OverlayState
  /** Última región capturada en esta pantalla, si la hay */
  lastRegion: Rect | null
  /** Hay una última región guardada (en esta u otra pantalla) */
  hasLastRegion: boolean
  /** Todas las pantallas, numeradas de izquierda a derecha */
  screens: ScreenInfo[]
}

export interface ScreenInfo {
  id: number
  /** Número visible (1, 2, 3…) */
  index: number
  /** Posición y tamaño en DIP (para dibujar el esquema) */
  bounds: Rect
  /** Resolución real en píxeles */
  width: number
  height: number
  primary: boolean
}

export interface OverlayResult {
  displayId: number
  rect: Rect
}

export interface Settings {
  saveDir: string
  format: 'png' | 'jpg'
  autoCopy: boolean
  autoSave: boolean
  hotkey: string
  /** Atajo para repetir la última región ('' = sin atajo) */
  hotkeyRepeat: string
  /** Atajo para copiar texto de la pantalla (OCR) ('' = sin atajo) */
  hotkeyText: string
  launchAtLogin: boolean
  lastState: OverlayState
  lastRegion: LastRegion | null
  /** Vista previa tras capturar */
  previewEnabled: boolean
  previewPosition: 'left' | 'right'
  previewSize: 's' | 'm' | 'l'
  /** Segundos hasta que se cierra sola (0 = nunca) */
  previewAutoClose: number
}

export interface PreviewData {
  kind: 'image' | 'video'
  path: string
  /** Miniatura (imagen) como data URL; para vídeo, URL reproducible */
  src: string
  width: number
  height: number
  /** Posición original en pantalla (DIP absolutos), para anclar la captura donde estaba */
  origin?: Rect
}

export interface RecorderInit {
  sourceId: string
  /** Tamaño físico de la pantalla en píxeles */
  screenWidth: number
  screenHeight: number
  /** Región a grabar en píxeles físicos, relativa a la pantalla */
  crop: Rect
  mic: boolean
  sysAudio: boolean
  clicks: boolean
  keys: boolean
}

/** Evento de entrada que se dibuja en la grabación (coordenadas físicas relativas a la región) */
export type InputEvent =
  | { type: 'click'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'key'; label: string; combo: boolean }

export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrLine {
  text: string
  words: OcrWord[]
}

export interface OcrResult {
  ok: boolean
  error?: string
  lang?: string
  lines: OcrLine[]
}

export interface ScrollInit {
  sourceId: string
  screenWidth: number
  screenHeight: number
  /** Región en píxeles físicos, relativa a la pantalla */
  crop: Rect
}

export interface HistoryItem {
  id: string
  kind: 'image' | 'video' | 'text'
  date: number
  /** Rutas relativas a la carpeta del historial */
  file: string
  thumb: string
  width?: number
  height?: number
  bytes: number
  /** Texto reconocido (solo para el tipo "text") */
  text?: string
  source: string
}

/** Opciones de exportación del editor de vídeo */
export interface ExportOptions {
  format: 'mp4' | 'gif' | 'webm'
  /** Recorte en segundos */
  start: number
  end: number
  /** Alto de salida (null = original) */
  height: number | null
  /** Fotogramas por segundo (null = original) */
  fps: number | null
  quality: 'high' | 'medium' | 'low'
}

/** Estado de la tarjeta de texto reconocido (OCR) */
export type TextCardState =
  | { status: 'loading' }
  | { status: 'done'; text: string; lang?: string; copied: boolean; qr?: string | null }
  | { status: 'error'; error: string }
