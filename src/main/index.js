import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './ipc.js'
import { DEFAULTS } from './data/defaults.js'
import { createConfigService } from './services/config.service.js'
import { createMemoryService } from './services/memory.service.js'
import { createCharactersService } from './services/characters.service.js'
import { createBrain } from './services/brain.service.js'
import { createWindowService } from './services/window.service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let win

function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 700,
    frame: false, transparent: true, resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/api.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const rootDir = app.getAppPath()
  const configSvc = createConfigService({ rootDir })
  configSvc.migrateLegacyIfNeeded()
  const memorySvc = createMemoryService({ rootDir })
  const charactersSvc = createCharactersService({
    outfitsDir: path.join(rootDir, 'assets', 'outfits'),
    emotions: DEFAULTS.emotions
  })
  const brainSvc = createBrain({
    config: configSvc,
    memory: memorySvc,
    onSummary: (summary) => {
      if (summary) configSvc.patchSave({ session_summary: summary })
    }
  })

  const services = {
    config: configSvc,
    memory: memorySvc,
    characters: charactersSvc,
    brain: brainSvc
  }

  createWindow()
  const windowSvc = createWindowService({ win, getConfig: () => services.config })
  windowSvc.applySettings()
  windowSvc.trackPosition()
  win.once('ready-to-show', () => windowSvc.restorePosition())

  registerIpc({ services, getWin: () => win })
})
app.on('window-all-closed', () => app.quit())
