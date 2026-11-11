// Ventana del historial: lista con filtros y acciones (abrir, copiar, guardar, anclar, borrar…).
// Los datos están en history.ts; este módulo es el que abre editores, ancladas y el reproductor.
import { BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron'
import { openEditor } from './editor'
import { copyImage, saveImageAs, saveVideoAs } from './files'
import { clearHistory, deleteFromHistory, findHistoryItem, historyPath, listHistory, onHistoryChanged } from './history'
import { handle, on, sendTo } from './ipc'
import { logError } from './log'
import { openPin } from './pin'
import { openPlayer } from './player'
import { historyUrl } from './protocol'
import { createWindow } from './windows'

let win: BrowserWindow | null = null

export function openHistory(): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = createWindow('history', { width: 1040, height: 720, minWidth: 640, minHeight: 420, title: 'Historial de capturas', backgroundColor: '#1c1c1f' })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
}

const find = findHistoryItem

export function registerHistoryIpc(): void {
  onHistoryChanged(() => sendTo(win?.webContents, 'history:changed'))

  handle('history:list', () =>
    listHistory().map((i) => ({ ...i, thumbUrl: i.thumb ? historyUrl(i.thumb) : '', fileUrl: historyUrl(i.file) }))
  )

  on('history:open', (_e, id: unknown) => {
    const it = find(id)
    if (!it) return
    const path = historyPath(it.file)
    if (it.kind === 'video') openPlayer({ kind: 'video', path, src: historyUrl(it.file), width: 0, height: 0 })
    else openEditor(path)
  })

  handle('history:copy', async (_e, id: unknown) => {
    const it = find(id)
    if (!it) return false
    if (it.kind === 'text' && it.text) await clipboard.writeText(it.text)
    else if (it.kind === 'image') await copyImage(nativeImage.createFromPath(historyPath(it.file)))
    else return false
    return true
  })

  handle('history:save', async (e, id: unknown) => {
    const it = find(id)
    const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
    if (!it) return null
    const src = historyPath(it.file)
    try {
      return it.kind === 'video' ? await saveVideoAs(parent, src) : await saveImageAs(parent, nativeImage.createFromPath(src))
    } catch (err) {
      logError('Historial: no se pudo guardar', err)
      dialog.showErrorBox('No se pudo guardar', String(err instanceof Error ? err.message : err))
      return null
    }
  })

  on('history:pin', (_e, id: unknown) => {
    const it = find(id)
    if (it && it.kind !== 'video') openPin(historyPath(it.file))
  })

  on('history:reveal', (_e, id: unknown) => {
    const it = find(id)
    if (it) shell.showItemInFolder(historyPath(it.file))
  })

  handle('history:delete', async (_e, raw: unknown) => {
    if (!Array.isArray(raw)) return false
    await deleteFromHistory(new Set(raw.filter((x): x is string => typeof x === 'string')))
    return true
  })

  handle('history:clear', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      type: 'warning' as const,
      buttons: ['Vaciar historial', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Vaciar historial',
      message: '¿Borrar todas las capturas del historial?',
      detail: 'Los archivos que hayas guardado en tu carpeta no se tocan.'
    }
    const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 0) return false
    await clearHistory()
    return true
  })
}
