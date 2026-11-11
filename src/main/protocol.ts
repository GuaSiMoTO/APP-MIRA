// Protocolo capturas:// para que las ventanas carguen archivos locales (temporales e historial)
// con soporte de rangos. Es el único sitio que sabe cómo se forman y se resuelven sus URL.
import { app, protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { tempDir } from './files'

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

/** URL de un archivo del historial («items/…» o «thumbs/…»). */
export function historyUrl(rel: string): string {
  return `capturas://historial/${rel.split('/').map(encodeURIComponent).join('/')}`
}
