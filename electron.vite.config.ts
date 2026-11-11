import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const pages = ['overlay', 'preview', 'editor', 'recorder', 'border', 'settings', 'player', 'ocr', 'pin', 'scroll', 'webcam', 'history', 'welcome']

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    build: { externalizeDeps: true }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `src/renderer/${p}.html`)]))
      }
    }
  }
})
