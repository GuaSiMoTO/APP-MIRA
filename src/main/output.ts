// Qué se hace con una captura terminada: copiarla, guardarla, añadirla al historial y mostrar
// la vista previa. Lo usan la captura normal, repetir región y la captura con desplazamiento.
import type { NativeImage } from 'electron'
import type { Rect } from '../shared/types'
import { copyImage, saveImageToFolder, writeTempImage } from './files'
import { addImageToHistory } from './history'
import { showPreview } from './preview'
import { getSettings } from './settings'

/** Copia/guarda según los ajustes y muestra la vista previa. `origin`: posición en pantalla (DIP). */
export async function finishImage(img: NativeImage, origin?: Rect): Promise<void> {
  const settings = getSettings()
  if (settings.autoCopy) await copyImage(img)
  if (settings.autoSave) await saveImageToFolder(img)
  const path = await writeTempImage(img)
  void addImageToHistory(path, img)
  const size = img.getSize()
  const thumb = img.resize(size.width > size.height ? { width: 560 } : { height: 400 })
  showPreview({ kind: 'image', path, src: thumb.toDataURL(), width: size.width, height: size.height, origin })
}
