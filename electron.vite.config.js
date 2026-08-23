import path from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const r = p => path.resolve(process.cwd(), p)

export default defineConfig({
  main: {},
  preload: {
    build: { rollupOptions: { input: { api: r('src/preload/api.js') } } }
  },
  renderer: {
    plugins: [react()],
    build: { rollupOptions: { input: r('src/renderer/index.html') } }
  }
})
