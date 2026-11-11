import { BrowserWindow, nativeImage, screen, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { copyImage, imageFromBytes, saveImageAs, saveImageToFolder, writeTempImage } from './media'
import { addImageToHistory } from './history'
import { logError } from './log'
import { ocrImage } from './ocr'
import { openPin } from './pin'
import { recognizeAndShow } from './textcard'
import { createWindow } from './windows'
import { handle, on, sendTo } from './ipc'

const files = new Map<number, string>()
/** Último archivo guardado por cada editor (para «Mostrar en la carpeta») */
const savedFiles = new Map<number, string>()
/** Editores con cambios sin guardar */
const dirty = new Set<number>()

/** Archivos abiertos o guardados por los editores abiertos (no se pueden borrar). */
export function editorFiles(): string[] {
  return [...files.values(), ...savedFiles.values()]
}

export function openEditor(path: string): void {
  const img = nativeImage.createFromPath(path)
  const size = img.getSize()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  // Tamaño inicial: la imagen a escala 1:1 más la interfaz, sin pasar del 90 % del área de trabajo
  const width = Math.min(Math.max(Math.round(size.width / display.scaleFactor) + 120, 1240), Math.round(wa.width * 0.9))
  const height = Math.min(Math.max(Math.round(size.height / display.scaleFactor) + 200, 640), Math.round(wa.height * 0.9))

  const win = createWindow('editor', {
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 760,
    minHeight: 480,
    title: 'Editor de capturas',
    backgroundColor: '#1c1c1f'
  })
  const id = win.webContents.id
  files.set(id, path)
  win.on('closed', () => {
    files.delete(id)
    savedFiles.delete(id)
    dirty.delete(id)
  })
  // Al cerrar con cambios sin guardar: Guardar / No guardar / Cancelar
  win.on('close', (ev) => {
    if (!dirty.has(id)) return
    ev.preventDefault()
    win.focus()
    sendTo(win.webContents, 'editor:confirm-close')
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
}

export function registerEditorIpc(): void {
  // La captura viaja en bytes (sin pasar por base64)
  handle('editor:init', async (e) => {
    const path = files.get(e.sender.id)
    if (!path) return null
    try {
      return await readFile(path)
    } catch (err) {
      logError('Editor: no se pudo leer la captura', err)
      return null
    }
  })

  handle('editor:copy', async (_e, png: unknown) => {
    await copyImage(imageFromBytes(png))
    return true
  })

  handle('editor:save', async (e, png: unknown) => {
    const img = imageFromBytes(png)
    void writeTempImage(img).then((p) => addImageToHistory(p, img, 'Editada'))
    const file = await saveImageToFolder(img)
    savedFiles.set(e.sender.id, file)
    return file
  })

  handle('editor:save-as', async (e, png: unknown) => {
    const file = await saveImageAs(BrowserWindow.fromWebContents(e.sender), imageFromBytes(png))
    if (file) savedFiles.set(e.sender.id, file)
    return file
  })

  // Se muestra el último archivo que guardó este editor, no una ruta enviada por la ventana
  on('editor:reveal', (e) => {
    const file = savedFiles.get(e.sender.id)
    if (file) shell.showItemInFolder(file)
  })

  on('editor:dirty', (ev, isDirty: unknown) => {
    if (isDirty === true) dirty.add(ev.sender.id)
    else dirty.delete(ev.sender.id)
  })
  on('editor:close-now', (ev) => {
    dirty.delete(ev.sender.id)
    BrowserWindow.fromWebContents(ev.sender)?.close()
  })

  // OCR de la imagen del editor (para la censura automática): coordenadas en px de la imagen
  handle('editor:ocr', (_e, png: unknown) => ocrImage(imageFromBytes(png)))

  // "Copiar texto": muestra la tarjeta con el texto reconocido
  on('editor:ocr-card', async (_e, png: unknown) => {
    try {
      await recognizeAndShow(imageFromBytes(png))
    } catch (err) {
      logError('Editor: no se pudo leer el texto de la imagen', err)
    }
  })

  on('editor:pin', async (_e, png: unknown) => {
    try {
      openPin(await writeTempImage(imageFromBytes(png)))
    } catch (err) {
      logError('Editor: no se pudo anclar la imagen', err)
    }
  })
}
