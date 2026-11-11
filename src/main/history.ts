// Historial de capturas: guarda las capturas, grabaciones y textos de los últimos 30 días en
// userData/historial (index.json + items/ + thumbs/). Solo datos: la ventana está en historywin.ts.
import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { copyFile, rm, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { HistoryItem } from '../shared/types'
import { ffmpegPath, runFfmpeg } from './ffmpeg'
import { logError } from './log'
import { readJson, writeJsonAtomic } from './store'
import { isNum, isObj, isStr, oneOf } from './validate'

const KEEP_DAYS = 30

const root = () => join(app.getPath('userData'), 'historial')
const itemsDir = () => join(root(), 'items')
const thumbsDir = () => join(root(), 'thumbs')
const indexFile = () => join(root(), 'index.json')

let items: HistoryItem[] | null = null

const isKind = oneOf(['image', 'video', 'text'] as const)
const isOptNum = (v: unknown) => v === undefined || isNum(v)

/** Elemento bien formado y con rutas dentro de la carpeta del historial (sin «..» ni rutas absolutas). */
function isHistoryItem(v: unknown): v is HistoryItem {
  return (
    isObj(v) &&
    isStr(v.id, 64) &&
    isKind(v.kind) &&
    isNum(v.date) &&
    isStr(v.file) &&
    /^items\/[\w-]+\.\w+$/.test(v.file) &&
    isStr(v.thumb) &&
    (v.thumb === '' || /^thumbs\/[\w-]+\.jpg$/.test(v.thumb)) &&
    isNum(v.bytes) &&
    isStr(v.source, 64) &&
    isOptNum(v.width) &&
    isOptNum(v.height) &&
    (v.text === undefined || typeof v.text === 'string')
  )
}

function load(): HistoryItem[] {
  if (items) return items
  mkdirSync(itemsDir(), { recursive: true })
  mkdirSync(thumbsDir(), { recursive: true })
  const raw = readJson(indexFile())
  const list = Array.isArray(raw) ? raw : []
  items = list.filter(isHistoryItem)
  if (items.length < list.length) logError(`Historial: se ignoran ${list.length - items.length} elementos no válidos`)
  return items
}

/** Escribe el índice ya (también al salir de la app, para no perder la última captura). */
export function flushHistory(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  if (!items) return
  try {
    writeJsonAtomic(indexFile(), items, 1)
  } catch (err) {
    logError('No se pudo guardar el historial', err)
  }
  changed?.()
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Agrupa las escrituras seguidas (varias capturas o borrados en poco tiempo) en una sola. */
function persist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(flushHistory, 200)
}

export function historyPath(file: string): string {
  return join(root(), file)
}

async function removeFiles(it: HistoryItem): Promise<void> {
  for (const f of [it.file, it.thumb]) if (f) await unlink(historyPath(f)).catch(() => {})
}

/** Borra lo que tenga más de 30 días. */
export async function pruneHistory(): Promise<void> {
  const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000
  // Primero se quitan del índice (sin esperas de por medio) y luego se borran sus archivos
  const old = load().filter((i) => i.date < limit)
  if (!old.length) return
  items = load().filter((i) => i.date >= limit)
  persist()
  for (const it of old) await removeFiles(it)
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function saveThumb(id: string, img: NativeImage): Promise<string> {
  const s = img.getSize()
  const t = s.width > s.height ? img.resize({ width: 360, quality: 'good' }) : img.resize({ height: 260, quality: 'good' })
  const rel = `thumbs/${id}.jpg`
  await writeFile(historyPath(rel), t.toJPEG(82))
  return rel
}

async function videoThumb(src: string, dest: string): Promise<boolean> {
  if (!ffmpegPath()) return false
  try {
    await runFfmpeg(['-ss', '0.5', '-i', src, '-frames:v', '1', '-vf', 'scale=360:-2', dest])
    return existsSync(dest)
  } catch (err) {
    logError('Historial: no se pudo crear la miniatura del vídeo', err)
    return false
  }
}

// Cambia al vaciar el historial: lo que se estaba añadiendo en ese momento ya no debe entrar
let generation = 0

/**
 * Mete un elemento en el índice cuando sus archivos ya están escritos. Se lee el índice en este
 * momento (no antes de las esperas), así no se pierden borrados ni otras capturas hechas mientras
 * tanto. Se ordena por fecha porque dos capturas pueden terminar en otro orden.
 */
async function insert(gen: number, item: HistoryItem): Promise<void> {
  if (gen !== generation) {
    await removeFiles(item)
    return
  }
  const list = load()
  const at = list.findIndex((i) => i.date < item.date)
  list.splice(at < 0 ? list.length : at, 0, item)
  persist()
}

/** Prepara un elemento nuevo: carpetas creadas, identificador, fecha y generación actual. */
function begin(): { gen: number; id: string; date: number } {
  load()
  return { gen: generation, id: newId(), date: Date.now() }
}

/** Añade una captura de imagen (archivo PNG ya escrito). */
export async function addImageToHistory(path: string, img?: NativeImage, source = 'Captura'): Promise<void> {
  try {
    const { gen, id, date } = begin()
    const file = `items/${id}${extname(path) || '.png'}`
    await copyFile(path, historyPath(file))
    const image = img ?? nativeImage.createFromPath(path)
    const size = image.getSize()
    const thumb = await saveThumb(id, image)
    await insert(gen, { id, kind: 'image', date, file, thumb, width: size.width, height: size.height, bytes: statSync(path).size, source })
  } catch (err) {
    logError('Historial: no se pudo añadir la imagen', err)
  }
}

export async function addVideoToHistory(path: string): Promise<void> {
  try {
    const { gen, id, date } = begin()
    const file = `items/${id}${extname(path) || '.webm'}`
    await copyFile(path, historyPath(file))
    const thumbRel = `thumbs/${id}.jpg`
    const hasThumb = await videoThumb(historyPath(file), historyPath(thumbRel))
    await insert(gen, { id, kind: 'video', date, file, thumb: hasThumb ? thumbRel : '', bytes: statSync(path).size, source: 'Grabación' })
  } catch (err) {
    logError('Historial: no se pudo añadir el vídeo', err)
  }
}

export async function addTextToHistory(text: string, img: NativeImage): Promise<void> {
  try {
    const { gen, id, date } = begin()
    const file = `items/${id}.png`
    await writeFile(historyPath(file), img.toPNG())
    const size = img.getSize()
    const thumb = await saveThumb(id, img)
    await insert(gen, { id, kind: 'text', date, file, thumb, width: size.width, height: size.height, bytes: text.length, text, source: 'Texto' })
  } catch (err) {
    logError('Historial: no se pudo añadir el texto', err)
  }
}

// ---------- Consultas y cambios (los usa la ventana del historial) ----------

let changed: (() => void) | null = null

/** Aviso cada vez que se guarda el índice (para refrescar la ventana del historial). */
export function onHistoryChanged(fn: () => void): void {
  changed = fn
}

/** Elementos del historial, del más reciente al más antiguo. */
export function listHistory(): readonly HistoryItem[] {
  return load()
}

export function findHistoryItem(id: unknown): HistoryItem | undefined {
  return typeof id === 'string' ? load().find((i) => i.id === id) : undefined
}

/** Borra elementos del historial y sus archivos. */
export async function deleteFromHistory(ids: ReadonlySet<string>): Promise<void> {
  // Primero se quitan del índice (sin esperas de por medio) y luego se borran sus archivos:
  // así dos borrados seguidos no pueden devolver al índice elementos ya borrados
  const removed = load().filter((i) => ids.has(i.id))
  items = load().filter((i) => !ids.has(i.id))
  persist()
  for (const it of removed) await removeFiles(it)
}

/** Borra todo el historial (no toca lo guardado en la carpeta del usuario). */
export async function clearHistory(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  generation++
  await rm(root(), { recursive: true, force: true })
  items = null
  load()
  flushHistory()
}
