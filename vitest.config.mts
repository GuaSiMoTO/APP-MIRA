import { defineConfig } from 'vitest/config'

// Tests unitarios de la lógica que no necesita pantalla ni Electron (se ejecutan en Node)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
