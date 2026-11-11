import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'

export const isDev = !app.isPackaged

export function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', ...parts)
    : join(app.getAppPath(), 'resources', ...parts)
}

export function createWindow(page: string, options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: '#00000000',
    icon: resourcePath('icon.png'),
    autoHideMenuBar: true,
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...options.webPreferences
    }
  })
  win.setMenu(null)
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  return win
}

/** Espera a que la página termine de cargar (para poder enviarle datos). */
export function ready(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (!win.webContents.isLoading()) resolve()
    else win.webContents.once('did-finish-load', () => resolve())
  })
}
