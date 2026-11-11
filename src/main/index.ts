import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, session, shell, Tray } from 'electron'
import { isCapturing, registerCaptureIpc, repeatLastRegion, startCapture } from './capture'
import { editorFiles, registerEditorIpc } from './editor'
import { flushHistory, pruneHistory } from './history'
import { openHistory, registerHistoryIpc } from './historywin'
import { cleanTempDir, ensureSaveDir } from './files'
import { handleProtocol, registerSchemes } from './protocol'
import { stopOcr, warmOcr } from './ocr'
import { closeAllPins, hasPins, pinFiles, registerPinIpc } from './pin'
import { playerFiles, registerPlayerIpc } from './player'
import { hasClosedPreview, previewFiles, registerPreviewIpc, restoreLastPreview } from './preview'
import { isRecording, registerRecorderIpc, stopRecording } from './recorder'
import { isScrolling, registerScrollIpc, stopScrolling } from './scroll'
import { getSettings, migrateFromOldName, pickSettings, updateSettings } from './settings'
import { registerTextCardIpc } from './textcard'
import { registerWelcomeIpc, showWelcome } from './welcome'
import { installedRunning, isTakeoverRequest, notifyTakeover, requestLock, takeOverInstalled } from './instance'
import { logError } from './log'
import { createWindow, resourcePath } from './windows'
import { handle, on } from './ipc'
import { HOTKEYS, prettyAccelerator, type HotkeyId } from '../shared/hotkeys'

// Instancia única. En desarrollo, si la Mira instalada está abierta, se cierra para dejar paso
const gotLock = requestLock()
// Si la otra copia no es la instalada (p. ej. otra de desarrollo), esta solo le avisa y termina
if (!gotLock && (app.isPackaged || !installedRunning())) {
  app.quit()
  process.exit(0)
}
const instanceReady: Promise<boolean> = gotLock ? Promise.resolve(true) : takeOverInstalled()

app.setAppUserModelId('com.javierbarroso.mira')
migrateFromOldName()
registerSchemes()

// ---------- Errores que no captura nadie ----------
// Sin esto solo salen por la consola (que nadie ve en la app instalada) y no llegan a mira.log

process.on('unhandledRejection', (reason) => logError('Promesa rechazada sin manejar', reason))
process.on('uncaughtException', (err) => logError('Excepción no capturada', err))
app.on('render-process-gone', (_e, wc, details) => logError(`Una ventana dejó de funcionar (${pageName(wc.getURL())})`, details.reason))
app.on('child-process-gone', (_e, details) => {
  if (details.reason !== 'clean-exit') logError(`Proceso auxiliar terminado (${details.type})`, details.reason)
})

/** «…/editor.html» → «editor» */
function pageName(url: string): string {
  return /([\w-]+)\.html/.exec(url)?.[1] ?? 'desconocida'
}

let tray: Tray | null = null
let settingsWin: BrowserWindow | null = null

// ---------- Atajos globales ----------


const actions: Record<HotkeyId, () => void> = {
  hotkey: () => {
    if (isRecording()) stopRecording()
    else if (isScrolling()) stopScrolling()
    else if (!isCapturing()) void startCapture()
  },
  hotkeyRepeat: () => void repeatLastRegion(),
  hotkeyText: () => void startCapture({ kind: 'text', mode: 'region' })
}
const registered: Partial<Record<HotkeyId, string>> = {}

function registerHotkey(id: HotkeyId, accelerator: string): boolean {
  const prev = registered[id]
  if (prev) globalShortcut.unregister(prev)
  delete registered[id]
  if (!accelerator) return true
  try {
    if (globalShortcut.register(accelerator, actions[id])) {
      registered[id] = accelerator
      return true
    }
  } catch (err) {
    logError(`Atajo no válido: ${accelerator}`, err)
  }
  return false
}

/** Atajos suspendidos mientras se graba uno nuevo en Ajustes. */
let hotkeysSuspended = false

function resumeHotkeys(): void {
  hotkeysSuspended = false
  registerAllHotkeys()
}

function registerAllHotkeys(): HotkeyId[] {
  const s = getSettings()
  return HOTKEYS.filter((id) => !registerHotkey(id, s[id]))
}

function hotkeyStatus(): Record<HotkeyId, boolean> {
  const s = getSettings()
  return { hotkey: registered.hotkey === s.hotkey, hotkeyRepeat: !s.hotkeyRepeat || registered.hotkeyRepeat === s.hotkeyRepeat, hotkeyText: !s.hotkeyText || registered.hotkeyText === s.hotkeyText }
}

const pretty = prettyAccelerator

// ---------- Ventanas y bandeja ----------

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = createWindow('settings', {
    width: 560,
    height: 860,
    resizable: false,
    maximizable: false,
    title: 'Ajustes de Mira',
    backgroundColor: '#1c1c1f'
  })
  settingsWin.once('ready-to-show', () => settingsWin?.show())
  settingsWin.on('closed', () => {
    settingsWin = null
    // Si se cierra mientras se graba un atajo, los atajos seguirían suspendidos hasta reiniciar
    if (hotkeysSuspended) resumeHotkeys()
  })
}

function buildTrayMenu(): void {
  if (!tray) return
  tray.setToolTip(`Mira — ${pretty(registered.hotkey) || 'sin atajo'}`)
  const acc = (id: HotkeyId) => registered[id] ?? undefined
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capturar imagen', accelerator: acc('hotkey'), click: () => void startCapture({ kind: 'photo' }) },
      { label: 'Grabar vídeo', click: () => void startCapture({ kind: 'video' }) },
      { label: 'Copiar texto de la pantalla', accelerator: acc('hotkeyText'), click: () => void startCapture({ kind: 'text', mode: 'region' }) },
      { label: 'Captura con desplazamiento', click: () => void startCapture({ kind: 'photo', mode: 'scroll' }) },
      {
        label: 'Repetir última región',
        accelerator: acc('hotkeyRepeat'),
        enabled: !!getSettings().lastRegion,
        click: () => void repeatLastRegion()
      },
      { type: 'separator' },
      { label: 'Historial de capturas…', click: openHistory },
      { label: 'Recuperar la última vista previa', enabled: hasClosedPreview(), click: () => restoreLastPreview() },
      { label: 'Cerrar capturas ancladas', enabled: hasPins(), click: closeAllPins },
      { label: 'Abrir carpeta de capturas', click: () => void shell.openPath(ensureSaveDir()) },
      { label: 'Ajustes…', click: openSettings },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() }
    ])
  )
}

// Errores de las ventanas (cada una limita cuántos envía)
on('app:error', (e, message: unknown) => {
  if (typeof message === 'string') logError(`Ventana ${pageName(e.sender.getURL())}`, message.slice(0, 4000))
})

function registerSettingsIpc(): void {
  handle('settings:get', () => ({ ...getSettings(), hotkeyStatus: hotkeyStatus() }))

  handle('settings:set', (_e, raw: unknown) => {
    const prev = getSettings()
    // Solo se aplican ajustes conocidos y con el tipo correcto
    const patch = pickSettings(raw)
    updateSettings(patch)
    let hotkeyOk = true
    for (const id of HOTKEYS) {
      if (patch[id] === undefined || patch[id] === registered[id]) continue
      if (!registerHotkey(id, patch[id]!)) {
        hotkeyOk = false
        registerHotkey(id, prev[id])
        updateSettings({ [id]: prev[id] })
      }
    }
    if (patch.launchAtLogin !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
    }
    buildTrayMenu()
    return { settings: { ...getSettings(), hotkeyStatus: hotkeyStatus() }, hotkeyOk }
  })

  handle('settings:choose-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: 'Carpeta de capturas', defaultPath: getSettings().saveDir, properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })

  // Mientras se edita un atajo en Ajustes, se suspenden para poder pulsarlos
  on('settings:suspend-hotkey', (_e, suspend: unknown) => {
    if (suspend === true) {
      hotkeysSuspended = true
      globalShortcut.unregisterAll()
      for (const id of HOTKEYS) delete registered[id]
    } else resumeHotkeys()
  })
}

// ---------- Limpieza ----------

const HOUSEKEEPING_INTERVAL_MS = 6 * 3600 * 1000
/** Los temporales (capturas, guardados del editor, grabaciones) se borran pasado un día. */
const TEMP_MAX_AGE_MS = 24 * 3600 * 1000

/** Poda el historial antiguo y borra los temporales que ya no usa ninguna ventana. */
async function housekeeping(): Promise<void> {
  try {
    await pruneHistory()
    const inUse = [...previewFiles(), ...editorFiles(), ...pinFiles(), ...playerFiles()]
    await cleanTempDir(TEMP_MAX_AGE_MS, inUse)
  } catch (err) {
    logError('Limpieza periódica', err)
  }
}

app.whenReady().then(async () => {
  if (!(await instanceReady)) {
    console.log('\n[Mira] Ya hay otra Mira en marcha y no se ha podido cerrar. Ciérrala desde la bandeja y vuelve a intentarlo.\n')
    app.quit()
    return
  }
  if (!gotLock) notifyTakeover()
  handleProtocol()

  // Permitir micrófono, cámara y captura de escritorio a nuestras propias páginas
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission)
  )

  registerCaptureIpc()
  registerPreviewIpc()
  registerEditorIpc()
  registerRecorderIpc()
  registerSettingsIpc()
  registerPlayerIpc()
  registerPinIpc()
  registerTextCardIpc()
  registerScrollIpc()
  registerHistoryIpc()
  registerWelcomeIpc()
  // La app pasa días abierta en la bandeja: la limpieza se repite, no solo al arrancar
  void housekeeping()
  setInterval(() => void housekeeping(), HOUSEKEEPING_INTERVAL_MS)

  const icon = nativeImage.createFromPath(resourcePath('icon.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16, quality: 'best' }))
  tray.on('click', () => void startCapture())
  // El menú se reconstruye al abrirlo para reflejar el estado (ancladas, última región…)
  tray.on('right-click', buildTrayMenu)

  const failed = registerAllHotkeys()
  if (failed.includes('hotkey')) {
    dialog.showErrorBox(
      'Atajo no disponible',
      `No se pudo registrar el atajo ${pretty(getSettings().hotkey)}. Otra aplicación lo está usando; cámbialo en Ajustes.`
    )
  }
  // Los atajos secundarios ocupados se desactivan sin molestar
  for (const id of failed) if (id !== 'hotkey') updateSettings({ [id]: '' })
  buildTrayMenu()

  // El OCR tarda en arrancar: se prepara en segundo plano
  setTimeout(warmOcr, 4000)

  // La app vive en la bandeja: aviso propio con el logo, "MIRA" y el atajo
  showWelcome(pretty(registered.hotkey), () => void startCapture())
})

app.on('second-instance', (_e, _argv, _cwd, data) => {
  // La versión de desarrollo pide paso: esta se cierra (guardando el historial pendiente)
  if (isTakeoverRequest(data)) {
    logError('Se cierra para dejar paso a la versión de desarrollo')
    app.quit()
    return
  }
  void startCapture()
})

// Es una app de bandeja: no se cierra al cerrar ventanas
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  flushHistory()
  globalShortcut.unregisterAll()
  stopOcr()
})
