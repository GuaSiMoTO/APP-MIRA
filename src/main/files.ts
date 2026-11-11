// Archivos de la app: carpeta temporal, nombres sin sobrescribir, guardar (también «Guardar como»),
// portapapeles e imágenes recibidas en bytes desde las ventanas.
import { app, clipboard, ClipboardItem, dialog, nativeImage, type BrowserWindow, type NativeImage, type SaveDialogOptions } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { convertVideo, ffmpegPath } from './ffmpeg'
import { getSettings } from './settings'

export function tempDir(): string {
  const dir = join(app.getPath('temp'), 'capturas')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function timestampName(ext: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `Captura ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(
    d.getMinutes()
  )}.${p(d.getSeconds())}.${ext}`
}

const samePath = (p: string) => resolve(p).toLowerCase() // en Windows las rutas no distinguen mayúsculas

/**
 * Borra de la carpeta temporal los archivos modificados hace más de `maxAgeMs` que no estén
 * en `inUse` (vistas previas, editores, ancladas…). El historial guarda su propia copia.
 * Devuelve cuántos se han borrado.
 */
export async function cleanTempDir(maxAgeMs: number, inUse: Iterable<string>, dir = tempDir()): Promise<number> {
  const keep = new Set([...inUse].map(samePath))
  const limit = Date.now() - maxAgeMs
  let removed = 0
  for (const name of await readdir(dir)) {
    const file = join(dir, name)
    if (keep.has(samePath(file))) continue
    try {
      const st = await stat(file)
      if (!st.isFile() || st.mtimeMs > limit) continue
      await unlink(file)
      removed++
    } catch {
      /* desaparecido o en uso por otro programa: se intentará la próxima vez */
    }
  }
  return removed
}

/** «Nombre.png» → «Nombre (2).png» (n = 1 deja el nombre tal cual). */
function numbered(name: string, n: number): string {
  if (n === 1) return name
  const ext = extname(name)
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`
}

const MAX_SAME_NAME = 1000

/**
 * Escribe en un archivo nuevo sin pisar ninguno: si «Nombre.png» existe prueba «Nombre (2).png»…
 * La comprobación y la creación son una sola operación (`wx`), así que dos capturas en el mismo
 * segundo nunca se quedan con el mismo archivo. Devuelve la ruta escrita.
 */
export async function writeNewFile(dir: string, name: string, data: Uint8Array): Promise<string> {
  for (let n = 1; n <= MAX_SAME_NAME; n++) {
    const file = join(dir, numbered(name, n))
    try {
      await writeFile(file, data, { flag: 'wx' })
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`Hay demasiados archivos llamados «${name}» en ${dir}`)
}

/** Primer nombre libre en `dir` (para proponerlo en «Guardar como»). */
export function freeName(dir: string, name: string): string {
  for (let n = 1; n <= MAX_SAME_NAME; n++) if (!existsSync(join(dir, numbered(name, n)))) return numbered(name, n)
  return name
}

export function encodeImage(img: NativeImage, format: 'png' | 'jpg'): Buffer {
  return format === 'jpg' ? img.toJPEG(92) : img.toPNG()
}

export async function writeTempImage(img: NativeImage): Promise<string> {
  return writeNewFile(tempDir(), timestampName('png'), img.toPNG())
}

export function ensureSaveDir(): string {
  const dir = getSettings().saveDir
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Guarda una imagen en la carpeta de capturas con el formato configurado. */
export async function saveImageToFolder(img: NativeImage): Promise<string> {
  const { format } = getSettings()
  return writeNewFile(ensureSaveDir(), timestampName(format), encodeImage(img, format))
}

// ---------- «Guardar como» (común a editor, vista previa, anclar, historial y vídeo) ----------

/** Nombre por defecto de una grabación: «Grabación 2026-…». */
export const recordingName = (ext: string): string => timestampName(ext).replace('Captura', 'Grabación')

/** Muestra el diálogo «Guardar como» (sobre `parent` si existe). Devuelve la ruta o null si se cancela. */
export async function askSavePath(parent: BrowserWindow | null | undefined, opts: SaveDialogOptions): Promise<string | null> {
  const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

const IMAGE_FILTERS = [
  { name: 'Imagen PNG', extensions: ['png'] },
  { name: 'Imagen JPG', extensions: ['jpg', 'jpeg'] }
]

/** «Guardar como» para imágenes: PNG o JPG según la extensión que elija el usuario. */
export async function saveImageAs(parent: BrowserWindow | null | undefined, img: NativeImage, title = 'Guardar captura como'): Promise<string | null> {
  const { format } = getSettings()
  const dir = ensureSaveDir()
  const file = await askSavePath(parent, { title, defaultPath: join(dir, freeName(dir, timestampName(format))), filters: IMAGE_FILTERS })
  if (!file) return null
  await writeFile(file, encodeImage(img, extname(file).toLowerCase() === '.png' ? 'png' : 'jpg'))
  return file
}

export type VideoFormat = 'mp4' | 'gif' | 'webm'

export const VIDEO_FILTERS: Record<VideoFormat, { name: string; extensions: string[] }> = {
  mp4: { name: 'Vídeo MP4', extensions: ['mp4'] },
  gif: { name: 'GIF animado', extensions: ['gif'] },
  webm: { name: 'Vídeo WebM', extensions: ['webm'] }
}

/**
 * «Guardar como» para una grabación: MP4, GIF o WebM (sin ffmpeg, solo WebM, que no necesita
 * conversión). Lanza un error si falla la conversión.
 */
export async function saveVideoAs(parent: BrowserWindow | null | undefined, src: string, title = 'Guardar grabación'): Promise<string | null> {
  const formats: VideoFormat[] = ffmpegPath() ? ['mp4', 'gif', 'webm'] : ['webm']
  const dir = ensureSaveDir()
  const file = await askSavePath(parent, {
    title,
    defaultPath: join(dir, freeName(dir, recordingName(formats[0]))),
    filters: formats.map((f) => VIDEO_FILTERS[f])
  })
  if (!file) return null
  await convertVideo(src, file)
  return file
}

export async function copyImage(img: NativeImage): Promise<void> {
  const png = new Blob([new Uint8Array(img.toPNG())], { type: "image/png" })
  await clipboard.write([new ClipboardItem({ "image/png": png })])
}

const MAX_IMAGE_BYTES = 256 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Bytes de una imagen enviada por una ventana (Uint8Array o ArrayBuffer). Lanza un error si no
 * son un PNG o un JPEG (por la firma del archivo) o si pasan del tamaño máximo.
 */
export function imageBytes(raw: unknown): Buffer {
  const view = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null
  if (!view || view.byteLength < 8) throw new Error('Imagen no válida')
  if (view.byteLength > MAX_IMAGE_BYTES) throw new Error('Imagen demasiado grande')
  const isPng = PNG_SIGNATURE.every((b, i) => view[i] === b)
  const isJpeg = view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff
  if (!isPng && !isJpeg) throw new Error('La imagen no es PNG ni JPEG')
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength)
}

/** Imagen enviada por una ventana en bytes (PNG o JPEG). Lanza un error si no es válida. */
export function imageFromBytes(raw: unknown): NativeImage {
  const img = nativeImage.createFromBuffer(imageBytes(raw))
  if (img.isEmpty()) throw new Error('Imagen vacía o dañada')
  return img
}
