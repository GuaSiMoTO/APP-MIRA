// Mapa de canales IPC: una sola fuente de verdad para el preload, las ventanas y el proceso principal.
// - Invoke: la ventana pide y espera respuesta (api.invoke ↔ handle).
// - Send: la ventana avisa al proceso principal (api.send ↔ on).
// - Events: el proceso principal avisa a una ventana (send ↔ api.on).
// Los argumentos están tipados en las ventanas; en el proceso principal llegan como `unknown` y se validan.
// Las imágenes viajan como bytes (Uint8Array), no como data URL en base64.
import type {
  ExportOptions,
  HistoryItem,
  InputEvent,
  OcrResult,
  OverlayInit,
  OverlayResult,
  OverlayState,
  PreviewData,
  RecorderInit,
  ScrollInit,
  Settings,
  TextCardState
} from './types'

import type { HotkeyId } from './hotkeys'

export type { HotkeyId }
/** Ajustes tal y como los ve la ventana de Ajustes (con el estado de cada atajo) */
export type SettingsView = Settings & { hotkeyStatus: Record<HotkeyId, boolean> }
/** Elemento del historial con las URL para mostrarlo */
export type HistoryListItem = HistoryItem & { thumbUrl: string; fileUrl: string }
/** Datos de la vista previa con el texto informativo y el cierre automático */
export type PreviewView = PreviewData & { info: string; autoClose: number }

/** Imagen PNG o JPEG en bytes */
export type ImageBytes = Uint8Array

interface Call<A extends unknown[], R> {
  args: A
  ret: R
}

export interface InvokeChannels {
  'editor:init': Call<[], ImageBytes | null>
  'editor:copy': Call<[png: ImageBytes], boolean>
  'editor:save': Call<[png: ImageBytes], string>
  'editor:save-as': Call<[png: ImageBytes], string | null>
  'editor:ocr': Call<[png: ImageBytes], OcrResult>
  'history:list': Call<[], HistoryListItem[]>
  'history:copy': Call<[id: string], boolean>
  'history:save': Call<[id: string], string | null>
  'history:delete': Call<[ids: string[]], boolean>
  'history:clear': Call<[], boolean>
  'settings:get': Call<[], SettingsView>
  'settings:set': Call<[patch: Partial<Settings>], { settings: SettingsView; hotkeyOk: boolean }>
  'settings:choose-dir': Call<[], string | null>
  'pin:get': Call<[], ImageBytes | null>
  'pin:opacity': Call<[delta: number], number>
  'pin:copy': Call<[], boolean>
  'player:get': Call<[], { src: string; name: string; ffmpeg: boolean } | null>
  'player:export': Call<[options: ExportOptions], string | null>
  'preview:copy': Call<[], boolean>
  'preview:save': Call<[], string | null>
  'preview:settings': Call<[], Settings>
  'recorder:init': Call<[], RecorderInit | null>
  'recorder:done': Call<[], void>
  'scroll:init': Call<[], ScrollInit | null>
  'scroll:wheel': Call<[notches: number], boolean>
  'scroll:done': Call<[png: ArrayBuffer], void>
  'ocr:copy': Call<[text: string], boolean>
}

export interface SendChannels {
  /** Error de una ventana, para guardarlo en mira.log */
  'app:error': [message: string]
  'overlay:ready': []
  'overlay:state': [state: OverlayState]
  'overlay:cancel': []
  'overlay:pick-screen': [id: number | 'all']
  'overlay:use-last': []
  'overlay:delay': [seconds: number]
  'overlay:done': [result: OverlayResult]
  'editor:reveal': []
  'editor:dirty': [dirty: boolean]
  'editor:close-now': []
  'editor:ocr-card': [png: ImageBytes]
  'editor:pin': [png: ImageBytes]
  'history:open': [id: string]
  'history:pin': [id: string]
  'history:reveal': [id: string]
  'settings:suspend-hotkey': [suspend: boolean]
  'pin:move': [dx: number, dy: number]
  'pin:zoom': [factor: number]
  'pin:reset': []
  'pin:close': []
  'pin:edit': []
  'pin:menu': []
  'player:close': []
  'player:maximize': []
  'preview:close': []
  'preview:restore': []
  'preview:edit': []
  'preview:pin': []
  'preview:play': []
  'preview:open': []
  'preview:drag': []
  'preview:folder': []
  'recorder:chunk': [webm: Uint8Array]
  'recorder:cancel': []
  'recorder:error': [message: string]
  'webcam:ready': [ready: boolean]
  'webcam:size': [size: 's' | 'm' | 'l']
  'webcam:close': []
  'scroll:cancel': []
  'scroll:error': [message: string]
  'ocr:open-url': [url: string]
  'ocr:close': []
  'welcome:click': []
  'welcome:close': []
}

export interface EventChannels {
  'overlay:init': [init: OverlayInit]
  'overlay:state': [state: OverlayState]
  'overlay:select-last': []
  'editor:confirm-close': []
  'history:changed': []
  'player:progress': [progress: number]
  'preview:data': [data: PreviewView]
  'recorder:stop': []
  'recorder:input': [event: InputEvent]
  'scroll:stop': []
  'ocr:state': [state: TextCardState]
  'welcome:data': [data: { icon: string; wordmark: string; hotkey: string }]
}

export type InvokeChannel = keyof InvokeChannels
export type SendChannel = keyof SendChannels
export type EventChannel = keyof EventChannels
