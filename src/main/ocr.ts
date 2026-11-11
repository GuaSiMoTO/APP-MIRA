// OCR con el motor de Windows mediante un proceso de PowerShell persistente (resources/ocr.ps1).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { NativeImage } from 'electron'
import type { OcrResult } from '../shared/types'
import { logError } from './log'
import { tempDir } from './files'
import { resourcePath } from './windows'

let proc: ChildProcessWithoutNullStreams | null = null
let ready: Promise<boolean> | null = null
let buffer = ''
const pending: Array<(line: string) => void> = []
let onReadyLine: ((line: string) => void) | null = null

/** Si PowerShell no responde en este tiempo se cierra y se vuelve a arrancar en la siguiente petición. */
const START_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 20_000

/** El último arranque falló porque Windows no tiene ningún idioma con OCR (y no por otra causa). */
let noLanguage = false

function start(): Promise<boolean> {
  if (ready) return ready
  noLanguage = false
  ready = new Promise<boolean>((resolve) => {
    try {
      // -ExecutionPolicy Bypass solo afecta a este proceso: permite ejecutar nuestro propio
      // script (resources/ocr.ps1) aunque la política del sistema bloquee los scripts
      proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resourcePath('ocr.ps1')],
        { windowsHide: true }
      )
    } catch (err) {
      logError('OCR: no se pudo iniciar PowerShell', err)
      ready = null
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      logError('OCR: PowerShell no respondió al arrancar')
      onReadyLine = null
      resolve(false)
      proc?.kill()
    }, START_TIMEOUT_MS)
    onReadyLine = (line) => {
      clearTimeout(timer)
      try {
        // El script responde { ready: true, ok } y ok = false si no hay idioma con OCR;
        // sin «ready» la respuesta es del cierre del proceso
        const res = JSON.parse(line) as { ready?: boolean; ok?: boolean; error?: string }
        noLanguage = res.ready === true && !res.ok
        if (!res.ok && !noLanguage) logError('OCR: el script no pudo arrancar', res.error)
        resolve(!!res.ok)
      } catch (err) {
        logError(`OCR: respuesta no válida al arrancar: ${line.slice(0, 200)}`, err)
        resolve(false)
      }
    }
    // Si PowerShell se cierra mientras se le escribe (EPIPE), el error llega por aquí y no
    // debe convertirse en una excepción sin capturar
    proc.stdin.on('error', (err) => logError('OCR: no se pudo escribir al proceso', err))
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (!line) continue
        if (onReadyLine) {
          const cb = onReadyLine
          onReadyLine = null
          cb(line)
        } else pending.shift()?.(line)
      }
    })
    proc.on('exit', () => {
      proc = null
      ready = null
      buffer = '' // una respuesta a medias del proceso cerrado no debe mezclarse con el siguiente
      onReadyLine?.('{"ok":false}')
      onReadyLine = null
      while (pending.length) pending.shift()!('{"ok":false,"error":"El proceso de OCR se cerró"}')
    })
    proc.on('error', (err) => {
      logError('OCR: error del proceso de PowerShell', err)
      clearTimeout(timer)
      resolve(false)
    })
  })
  return ready
}

/** Envía una imagen al proceso y espera su línea de respuesta, con tiempo límite. */
function request(file: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      const i = pending.indexOf(answer)
      if (i >= 0) pending.splice(i, 1)
      logError('OCR: tiempo de espera agotado; se reinicia el proceso')
      resolve(JSON.stringify({ ok: false, error: 'El reconocimiento de texto tardó demasiado. Inténtalo de nuevo.' }))
      // Las respuestas van en orden: tras un cuelgue ya no se puede saber cuál es cuál,
      // así que se cierra el proceso (las demás peticiones reciben un error) y se arranca otro
      proc?.kill()
    }, REQUEST_TIMEOUT_MS)
    const answer = (line: string) => {
      clearTimeout(timer)
      resolve(line)
    }
    pending.push(answer)
    proc!.stdin.write(file + '\n')
  })
}

/** Arranca el OCR en segundo plano para que la primera petición sea rápida. */
export function warmOcr(): void {
  void start()
}

export function stopOcr(): void {
  proc?.kill()
}

const START_FAILED = 'No se pudo iniciar el reconocimiento de texto de Windows. Inténtalo de nuevo (el detalle está en mira.log).'
const NO_LANGUAGE =
  'Windows no tiene instalado ningún idioma con reconocimiento de texto. Añádelo en Configuración → Hora e idioma → Idioma → (tu idioma) → Opciones → Reconocimiento óptico de caracteres.'

/** Reconoce el texto de una imagen. Las coordenadas devueltas son píxeles de la imagen original. */
export async function ocrImage(img: NativeImage): Promise<OcrResult> {
  const ok = await start()
  if (!ok || !proc) return { ok: false, error: noLanguage ? NO_LANGUAGE : START_FAILED, lines: [] }

  // Ampliar imágenes pequeñas mejora mucho la precisión con texto de interfaz
  const size = img.getSize()
  const factor = Math.max(size.width, size.height) < 1600 ? 2 : 1
  const input = factor > 1 ? img.resize({ width: size.width * factor, height: size.height * factor, quality: 'best' }) : img
  const file = join(tempDir(), `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  await writeFile(file, input.toPNG())

  try {
    const line = await request(file)
    const res = JSON.parse(line) as OcrResult
    if (!res.ok) return { ok: false, error: res.error === 'no-language' ? NO_LANGUAGE : res.error, lines: [] }
    if (factor > 1)
      for (const l of res.lines)
        for (const w of l.words) {
          w.x /= factor
          w.y /= factor
          w.w /= factor
          w.h /= factor
        }
    return res
  } catch (err) {
    return { ok: false, error: String(err), lines: [] }
  } finally {
    void unlink(file).catch(() => {})
  }
}

/**
 * Texto plano en orden de lectura. El OCR de Windows a veces trocea un mismo renglón en
 * varias "líneas" (p. ej. columnas de una tabla): se reagrupan por posición vertical y se
 * ordenan de izquierda a derecha, separando columnas lejanas con un tabulador.
 */
export function ocrText(res: OcrResult): string {
  const pieces = res.lines
    .filter((l) => l.words.length)
    .map((l) => {
      const x = Math.min(...l.words.map((w) => w.x))
      const right = Math.max(...l.words.map((w) => w.x + w.w))
      const top = Math.min(...l.words.map((w) => w.y))
      const bottom = Math.max(...l.words.map((w) => w.y + w.h))
      return { text: l.text, x, right, cy: (top + bottom) / 2, h: bottom - top }
    })
    .sort((a, b) => a.cy - b.cy)

  const rows: (typeof pieces)[] = []
  for (const p of pieces) {
    const row = rows[rows.length - 1]
    const ref = row?.[0]
    if (ref && Math.abs(p.cy - ref.cy) < Math.max(ref.h, p.h) * 0.5) row.push(p)
    else rows.push([p])
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x)
      let out = row[0].text
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - row[i - 1].right
        out += (gap > row[i].h * 2.5 ? '\t' : ' ') + row[i].text
      }
      return out
    })
    .join('\n')
}
