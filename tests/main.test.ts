// Lógica del proceso principal: se sustituye Electron por un simulacro mínimo
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\tmp\\mira-test' },
  clipboard: {},
  ClipboardItem: class {},
  nativeImage: {},
  protocol: {}
}))

const { cleanTempDir, freeName, imageBytes, writeNewFile } = await import('../src/main/files')
const { convertVideo, probeMedia, runFfmpeg, spawnFfmpeg } = await import('../src/main/ffmpeg')
const { parseRange } = await import('../src/main/protocol')
const { pickSettings, pickState } = await import('../src/main/settings')
const { isRect, oneOf, toBuffer } = await import('../src/main/validate')
import type { OverlayState, Settings } from '../src/shared/types'
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('parseRange (protocolo capturas://)', () => {
  it('sin cabecera se sirve el archivo entero', () => {
    expect(parseRange(null, 1000)).toBeNull()
  })
  it('rango normal', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
  })
  it('desde una posición hasta el final', () => {
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
  })
  it('los N últimos bytes', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })
  it('recorta el final al tamaño del archivo', () => {
    expect(parseRange('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 })
  })
  it('fuera del archivo → 416', () => {
    expect(parseRange('bytes=2000-', 1000)).toBe('unsatisfiable')
  })
})

const base: Settings = {
  saveDir: 'C:\\Users\\x\\Pictures\\Capturas',
  format: 'png',
  autoCopy: true,
  autoSave: false,
  hotkey: 'Control+Shift+S',
  hotkeyRepeat: 'Alt+Shift+R',
  hotkeyText: 'Alt+Shift+T',
  launchAtLogin: false,
  lastState: { kind: 'photo', mode: 'region', delay: 0, mic: false, sysAudio: false, clicks: true, keys: false, camera: false },
  lastRegion: null,
  previewEnabled: true,
  previewPosition: 'left',
  previewSize: 'm',
  previewAutoClose: 7
}

describe('pickSettings', () => {
  it('acepta valores válidos', () => {
    expect(pickSettings({ format: 'jpg', autoSave: true, previewAutoClose: 0, saveDir: 'D:\\Capturas' }, base)).toEqual({
      format: 'jpg',
      autoSave: true,
      previewAutoClose: 0,
      saveDir: 'D:\\Capturas'
    })
  })

  it('ignora claves desconocidas y tipos incorrectos', () => {
    expect(pickSettings({ format: 'gif', hotkey: 5, malo: 1, previewAutoClose: -1, saveDir: 'relativo' }, base)).toEqual({})
  })

  it('valida la última región', () => {
    const region = { displayId: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }
    expect(pickSettings({ lastRegion: region }, base)).toEqual({ lastRegion: region })
    expect(pickSettings({ lastRegion: { displayId: 1, rect: { x: 'a' } } }, base)).toEqual({})
    expect(pickSettings({ lastRegion: null }, base)).toEqual({ lastRegion: null })
  })

  it('no acepta algo que no sea un objeto', () => {
    expect(pickSettings('hola', base)).toEqual({})
    expect(pickSettings(null, base)).toEqual({})
    expect(pickSettings([1, 2], base)).toEqual({})
  })
})

describe('pickState', () => {
  const state: OverlayState = base.lastState

  it('cada campo no válido toma el valor anterior', () => {
    expect(pickState({ kind: 'video', mode: 'nada', delay: 7, mic: 'sí', camera: true }, state)).toEqual({
      ...state,
      kind: 'video',
      camera: true
    })
  })

  it('completa campos que faltan (ajustes de versiones antiguas)', () => {
    expect(pickState({ kind: 'text' }, state)).toEqual({ ...state, kind: 'text' })
    expect(pickState(undefined, state)).toEqual(state)
  })
})

describe('validate', () => {
  it('isRect exige números finitos y tamaño no negativo', () => {
    expect(isRect({ x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(isRect({ x: 1, y: 2, width: -3, height: 4 })).toBe(false)
    expect(isRect({ x: NaN, y: 2, width: 3, height: 4 })).toBe(false)
    expect(isRect(null)).toBe(false)
  })

  it('oneOf solo acepta los valores de la lista', () => {
    const isDelay = oneOf([3, 5, 10] as const)
    expect(isDelay(5)).toBe(true)
    expect(isDelay(4)).toBe(false)
    expect(isDelay('5')).toBe(false)
  })
})

describe('imágenes en bytes por IPC', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])
  it('acepta PNG y JPEG como Uint8Array o ArrayBuffer', () => {
    expect(imageBytes(png).length).toBe(png.length)
    expect(imageBytes(jpeg.buffer).length).toBe(jpeg.length)
  })
  it('respeta el desplazamiento de una vista sobre un buffer mayor', () => {
    const big = new Uint8Array(20)
    big.set(png, 4)
    expect([...imageBytes(big.subarray(4, 4 + png.length))]).toEqual([...png])
  })
  it('rechaza lo que no es una imagen', () => {
    expect(() => imageBytes('data:image/png;base64,AAAA')).toThrow()
    expect(() => imageBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow()
    expect(() => imageBytes(new Uint8Array(4))).toThrow()
    expect(() => imageBytes(null)).toThrow()
  })
  it('toBuffer solo acepta bytes', () => {
    expect(toBuffer(new ArrayBuffer(3))?.length).toBe(3)
    expect(toBuffer(new Uint8Array(5).subarray(1, 3))?.length).toBe(2)
    expect(toBuffer('abc')).toBeNull()
    expect(toBuffer([1, 2])).toBeNull()
  })
})

describe('writeNewFile (nunca sobrescribe)', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'mira-test-'))

  it('usa el nombre tal cual si está libre', async () => {
    const dir = tmp()
    const file = await writeNewFile(dir, 'Captura 1.png', new Uint8Array([1]))
    expect(file).toBe(join(dir, 'Captura 1.png'))
    rmSync(dir, { recursive: true })
  })
  it('dos capturas en el mismo segundo no se pisan', async () => {
    const dir = tmp()
    const [a, b, c] = await Promise.all([1, 2, 3].map((n) => writeNewFile(dir, 'Captura 1.png', new Uint8Array([n]))))
    expect(new Set([a, b, c]).size).toBe(3)
    expect(readdirSync(dir).sort()).toEqual(['Captura 1 (2).png', 'Captura 1 (3).png', 'Captura 1.png'])
    expect([a, b, c].map((f) => readFileSync(f)[0]).sort()).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true })
  })
  it('freeName propone el primer nombre libre', async () => {
    const dir = tmp()
    expect(freeName(dir, 'Grabación.mp4')).toBe('Grabación.mp4')
    await writeNewFile(dir, 'Grabación.mp4', new Uint8Array([1]))
    expect(freeName(dir, 'Grabación.mp4')).toBe('Grabación (2).mp4')
    rmSync(dir, { recursive: true })
  })
})

describe('cleanTempDir', () => {
  it('borra solo lo antiguo que no está abierto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mira-test-'))
    const old = (name: string) => {
      writeFileSync(join(dir, name), 'x')
      const t = new Date(Date.now() - 2 * 24 * 3600 * 1000)
      utimesSync(join(dir, name), t, t)
    }
    old('vieja.png')
    old('anclada.png')
    writeFileSync(join(dir, 'reciente.png'), 'x')
    const removed = await cleanTempDir(24 * 3600 * 1000, [join(dir, 'ANCLADA.png')], dir)
    expect(removed).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['anclada.png', 'reciente.png'])
    rmSync(dir, { recursive: true })
  })
})

describe('ffmpeg', () => {
  it('detiene un ffmpeg que deja de responder', async () => {
    // Lee de la entrada estándar, que nadie escribe: se queda esperando sin dar señales
    await expect(spawnFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-s', '2x2', '-i', 'pipe:0', '-f', 'null', '-'], 500)).rejects.toThrow(/no respondió/)
  })
  it('un fallo de ffmpeg llega con su mensaje', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mira-test-'))
    await expect(runFfmpeg(['-i', join(dir, 'no-existe.webm'), join(dir, 'x.mp4')])).rejects.toThrow(/no-existe/)
    rmSync(dir, { recursive: true })
  })
  it('genera, lee y convierte un vídeo real (MP4 y GIF)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mira-test-'))
    const src = join(dir, 'prueba.webm')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10', '-t', '1', '-c:v', 'libvpx', src])
    const { duration } = await probeMedia(src)
    expect(duration).toBeGreaterThan(0.9)
    await convertVideo(src, join(dir, 'prueba.mp4'))
    await convertVideo(src, join(dir, 'prueba.gif'))
    expect((await probeMedia(join(dir, 'prueba.mp4'))).duration).toBeCloseTo(duration, 0)
    expect(readdirSync(dir).sort()).toEqual(['prueba.gif', 'prueba.mp4', 'prueba.webm'])
    rmSync(dir, { recursive: true })
  }, 30_000)
  it('no convierte un vídeo cuya duración no se puede leer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mira-test-'))
    writeFileSync(join(dir, 'roto.webm'), 'no es un vídeo')
    await expect(convertVideo(join(dir, 'roto.webm'), join(dir, 'x.mp4'))).rejects.toThrow(/duración/)
    expect(readdirSync(dir)).toEqual(['roto.webm'])
    rmSync(dir, { recursive: true })
  })
})
