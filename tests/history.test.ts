// Historial: altas, bajas y vaciado que ocurren a la vez (sin pantalla; Electron simulado)
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'mira-history-'))
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false },
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn),
    on: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn)
  },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  BrowserWindow: { fromWebContents: () => null },
  clipboard: {},
  ClipboardItem: class {},
  nativeImage: {},
  protocol: {},
  screen: {},
  shell: {}
}))

const history = await import('../src/main/history')
history.registerHistoryIpc()

/** Imagen falsa: lo justo para que el historial la guarde. */
const fakeImage = {
  toPNG: () => Buffer.from([1]),
  toJPEG: () => Buffer.from([2]),
  getSize: () => ({ width: 10, height: 10 }),
  resize() {
    return this
  }
} as unknown as Electron.NativeImage

const list = () => handlers.get('history:list')!() as { id: string; text?: string }[]
const texts = () => list().map((i) => i.text)
const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({ sender: {} }, ...args)

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('historial con operaciones a la vez', () => {
  it('un borrado durante dos altas no pierde ninguna y no resucita lo borrado', async () => {
    await history.addTextToHistory('viejo', fakeImage)
    const viejo = list()[0].id
    const a = history.addTextToHistory('a', fakeImage)
    const b = history.addTextToHistory('b', fakeImage)
    await call('history:delete', [viejo])
    await Promise.all([a, b])
    expect(texts().sort()).toEqual(['a', 'b'])
  })

  it('lo que se añadía mientras se vaciaba no entra ni deja archivos', async () => {
    const pending = history.addTextToHistory('durante', fakeImage)
    await call('history:clear')
    await pending
    expect(list()).toEqual([])
    expect(readdirSync(join(userData, 'historial', 'items'))).toEqual([])
  })
})
