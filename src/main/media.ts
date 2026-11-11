import { app, clipboard, ClipboardItem, dialog, nativeImage, protocol, type BrowserWindow, type NativeImage, type SaveDialogOptions } from 'electron'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { copyFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { ExportOptions } from '../shared/types'
import { logError } from './log'
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

export async function copyFileTo(src: string, dest: string): Promise<void> {
  await copyFile(src, dest)
}

// ---------- Protocolo para servir archivos temporales (vídeo) a los renderers ----------

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'capturas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

const MIME: Record<string, string> = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png', '.gif': 'image/gif' }

/**
 * Cabecera HTTP `Range: bytes=inicio-fin` (los dos extremos incluidos) para un archivo de `size` bytes.
 * null = no se pidió un rango (se sirve entero); 'unsatisfiable' = rango fuera del archivo (416).
 * `bytes=-N` son los N últimos bytes y `bytes=N-` va desde N hasta el final.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = /bytes=(\d*)-(\d*)/.exec(header ?? '')
  if (!m) return null
  const start = Math.max(0, m[1] ? Number(m[1]) : size - Number(m[2]))
  const end = Math.min(size - 1, m[1] && m[2] ? Number(m[2]) : size - 1)
  return start > end ? 'unsatisfiable' : { start, end }
}

export function handleProtocol(): void {
  // Sirve los archivos temporales con soporte de rangos (206), imprescindible para poder
  // saltar a cualquier punto del vídeo en el reproductor
  protocol.handle('capturas', async (req) => {
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    // Solo se sirven archivos de las carpetas permitidas (sin rutas relativas)
    const file =
      url.hostname === 'historial' && parts.length === 2 && (parts[0] === 'items' || parts[0] === 'thumbs')
        ? join(app.getPath('userData'), 'historial', parts[0], basename(parts[1]))
        : join(tempDir(), basename(parts.join('/')))
    if (!existsSync(file)) return new Response('No encontrado', { status: 404 })
    const size = statSync(file).size
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const range = parseRange(req.headers.get('range'), size)
    if (!range) {
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
      })
    }
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const { start, end } = range
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}

export function mediaUrl(file: string): string {
  return `capturas://media/${encodeURIComponent(basename(file))}`
}

// ---------- ffmpeg ----------

let ffmpegMissingLogged = false

/** Ruta de ffmpeg, o null si falta (sin él no hay MP4, GIF ni miniaturas de vídeo). */
export function ffmpegPath(): string | null {
  let found: string | null = null
  let cause: unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p: string | null = require('ffmpeg-static')
    const fixed = p?.replace('app.asar', 'app.asar.unpacked')
    if (fixed && existsSync(fixed)) found = fixed
    else cause = fixed ?? 'ffmpeg-static no tiene binario para esta plataforma'
  } catch (err) {
    cause = err
  }
  // Se anota una vez: así se sabe por qué faltan MP4 y GIF en «Guardar como»
  if (!found && !ffmpegMissingLogged) {
    ffmpegMissingLogged = true
    logError('No se encuentra ffmpeg: solo se podrán guardar vídeos WebM', cause)
  }
  return found
}

/** Sin noticias de ffmpeg durante este tiempo se da por colgado (p. ej. con un archivo dañado). */
const FFMPEG_IDLE_MS = 60_000
/** Leer la cabecera es casi instantáneo. */
const FFMPEG_PROBE_MS = 15_000
const FFMPEG_STDERR_MAX = 64 * 1024

interface FfmpegRun {
  code: number | null
  stderr: string
}

/**
 * Único punto donde se lanza ffmpeg. Lo mata si pasa `idleMs` sin escribir nada: las tareas
 * largas usan `-progress pipe:1`, que informa cada medio segundo, así que el silencio significa
 * que se ha colgado. Rechaza si no se puede lanzar o si se cuelga; si no, devuelve el código.
 */
export function spawnFfmpeg(args: string[], idleMs: number, onStdout?: (chunk: string) => void): Promise<FfmpegRun> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg no está disponible'))
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    const watch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        proc.kill()
      }, idleMs)
    }
    watch()
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => {
      watch()
      onStdout?.(d)
    })
    proc.stderr.on('data', (d) => {
      watch()
      if (stderr.length < FFMPEG_STDERR_MAX) stderr += d
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`ffmpeg no respondió en ${Math.round(idleMs / 1000)} s y se ha detenido`))
      else resolve({ code, stderr })
    })
  })
}

/** Ejecuta una tarea de ffmpeg; rechaza con su mensaje de error si no termina bien. */
export async function runFfmpeg(args: string[]): Promise<void> {
  const r = await spawnFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args], FFMPEG_IDLE_MS)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `ffmpeg salió con ${r.code}`)
}

/** MediaRecorder genera WebM sin duración; se remuxa para que se pueda avanzar en el vídeo. */
export async function fixWebm(file: string): Promise<void> {
  if (!ffmpegPath()) return
  const tmp = file.replace(/\.webm$/, '.fixed.webm')
  try {
    await runFfmpeg(['-i', file, '-c', 'copy', tmp])
    await unlink(file)
    await rename(tmp, file)
  } catch (err) {
    logError('No se pudo remuxar el WebM', err)
    await unlink(tmp).catch(() => {})
  }
}

export type { ExportOptions }

/** Duración y si hay pista de audio (leído de la cabecera con ffmpeg). */
export async function probeMedia(src: string): Promise<{ duration: number; audio: boolean }> {
  if (!ffmpegPath()) return { duration: 0, audio: false }
  try {
    // Sin archivo de salida ffmpeg termina con error, pero antes describe la entrada en stderr
    const { stderr } = await spawnFfmpeg(['-hide_banner', '-i', src], FFMPEG_PROBE_MS)
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)
    const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
    return { duration, audio: /Stream #\d+:\d+.*Audio:/.test(stderr) }
  } catch (err) {
    logError(`No se pudo leer la cabecera de ${src}`, err)
    return { duration: 0, audio: false }
  }
}

/**
 * Exporta el vídeo con recorte, resolución, fps y calidad. onProgress recibe 0…1.
 * Las grabaciones tienen huecos de tiempo cuando la pantalla está quieta (el codificador no
 * emite fotogramas iguales). Para que el recorte dure exactamente lo elegido se rellena primero
 * la línea de tiempo (fps + tpad) y después se recorta con filtros (trim), sin buscar en la entrada.
 */
export async function exportVideo(src: string, dest: string, o: ExportOptions, onProgress: (p: number) => void): Promise<void> {
  if (!ffmpegPath()) throw new Error('ffmpeg no está disponible')
  const info = await probeMedia(src)
  const duration = Math.max(0.1, o.end - o.start)
  const fps = o.fps ?? (o.format === 'gif' ? 15 : 30)
  const s = o.start.toFixed(3)
  const e = o.end.toFixed(3)

  const v = [`fps=${fps}`, `tpad=stop_mode=clone:stop_duration=${Math.ceil(o.end) + 2}`, `trim=start=${s}:end=${e}`, 'setpts=PTS-STARTPTS']
  if (o.height) v.push(`scale=-2:${o.height}:flags=lanczos`)
  else if (o.format === 'mp4') v.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')

  let graph: string
  if (o.format === 'gif') {
    const colors = { high: 256, medium: 128, low: 64 }[o.quality]
    const dither = o.quality === 'low' ? 'bayer:bayer_scale=3' : 'sierra2_4a'
    graph = `[0:v]${v.join(',')},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}[v]`
  } else {
    graph = `[0:v]${v.join(',')}[v]`
    if (info.audio) graph += `;[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a]`
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-i', src, '-filter_complex', graph, '-map', '[v]']
  if (o.format !== 'gif' && info.audio) args.push('-map', '[a]')
  if (o.format === 'gif') {
    args.push('-loop', '0')
  } else if (o.format === 'mp4') {
    const crf = { high: 18, medium: 23, low: 28 }[o.quality]
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart')
  } else {
    const crf = { high: 28, medium: 34, low: 40 }[o.quality]
    args.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-c:a', 'libopus')
  }
  args.push(dest)

  let buf = ''
  const r = await spawnFfmpeg(args, FFMPEG_IDLE_MS, (d) => {
    buf += d
    const m = buf.match(/out_time_(?:ms|us)=(\d+)/g)
    if (m) {
      const us = Number(m[m.length - 1].split('=')[1])
      onProgress(Math.min(1, us / 1e6 / duration))
      buf = buf.slice(buf.lastIndexOf('\n') + 1)
    }
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || `ffmpeg salió con ${r.code}`)
  onProgress(1)
}

/** Guardar la grabación completa ("Guardar vídeo…" de la vista previa) con calidad estándar. */
export async function convertVideo(src: string, dest: string): Promise<void> {
  const ext = extname(dest).toLowerCase()
  if (ext === '.webm') return copyFile(src, dest)
  if (ext !== '.mp4' && ext !== '.gif') throw new Error(`Formato no soportado: ${ext}`)
  const { duration } = await probeMedia(src)
  // Sin duración no se puede recortar: antes se suponía 1 hora y salía un vídeo congelado enorme
  if (!(duration > 0)) throw new Error('No se pudo leer la duración de la grabación. Guárdala como WebM.')
  const gif = ext === '.gif'
  return exportVideo(src, dest, { format: gif ? 'gif' : 'mp4', start: 0, end: duration, height: null, fps: gif ? 15 : null, quality: gif ? 'medium' : 'high' }, () => {})
}
