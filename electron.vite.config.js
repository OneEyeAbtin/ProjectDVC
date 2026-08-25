import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const r = (p) => path.resolve(process.cwd(), p)

// Copies raw outfit sprites next to the built renderer so production
// (file:// pages) can load them same-origin; dev uses the /@fs/ route.
function copySprites() {
  return {
    name: 'copy-sprites',
    apply: 'build',
    closeBundle() {
      const src = r('assets/outfits')
      const dest = r('out/renderer/sprites')
      if (!fs.existsSync(src)) return
      // Prune stale sprites from a previous build so removed outfit files
      // don't linger in the production output.
      fs.rmSync(dest, { recursive: true, force: true })
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(entry.name)) continue
        fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name))
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // ws is a transitive dep (via msedge-tts) whose optional native
        // modules (bufferutil, utf-8-validate) can't be bundled — keep it
        // external so ws's own runtime fallback handling applies.
        external: ['ws', 'bufferutil', 'utf-8-validate']
      }
    }
  },
  preload: {
    build: { rollupOptions: { input: { api: r('src/preload/api.js') } } }
  },
  renderer: {
    plugins: [react(), copySprites()],
    server: { fs: { allow: [r('.')] } },
    build: { rollupOptions: { input: r('src/renderer/index.html') } }
  }
})
