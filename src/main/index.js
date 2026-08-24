import { app, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './ipc.js'
import { DEFAULTS } from './data/defaults.js'
import { createConfigService } from './services/config.service.js'
import { createMemoryService } from './services/memory.service.js'
import { createCharactersService } from './services/characters.service.js'
import { createBrain } from './services/brain.service.js'
import { createWindowService } from './services/window.service.js'
import { createVoiceService } from './services/voice.service.js'
import { registerMediaProtocol } from './media-protocol.js'
import { createQuitFlush } from './lib/session-cache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Must happen before app ready — makes dvc-media:// a standard, secure,
// fetchable, streamable scheme for the renderer's <audio> elements.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dvc-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])
let win
// Assigned once services exist inside whenReady; the module-level before-quit
// listener below reads through it so registration order never matters.
let flushSessionCacheRef = null
let ipcDisposeRef = null

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

  // Mutable services bag: every callback/handler must read through it so the
  // profile:factory-reset instance swap never leaves a stale reference behind
  // (audit #3). The brain below captures config/memory directly, but it is
  // itself replaced on reset — its onSummary closure is what must stay live.
  const services = {
    config: configSvc,
    memory: memorySvc,
    characters: charactersSvc
  }

  const brainSvc = createBrain({
    config: configSvc,
    memory: memorySvc,
    onSummary: (summary) => {
      if (summary) services.config.patchSave({ session_summary: summary })
    }
  })
  services.brain = brainSvc

  // Voice reads config through a live closure so the factory-reset instance
  // swap in ipc.js can never strand it with stale settings.
  services.voice = createVoiceService({
    rootDir,
    getConfig: () => services.config.getConfig()
  })
  registerMediaProtocol({
    getRoots: () => [
      { mount: 'tts-cache', root: path.join(rootDir, 'data', 'tts-cache') },
      { root: path.join(rootDir, 'assets') }
    ]
  })

  // Crash recovery: summarize any history cached at previous shutdown.
  brainSvc.compressPending()

  createWindow()
  const flushSessionCache = createQuitFlush({ getServices: () => services })
  flushSessionCacheRef = flushSessionCache
  const windowSvc = createWindowService({
    win,
    getConfig: () => services.config,
    onCloseToQuit: flushSessionCache
  })
  windowSvc.applySettings()
  windowSvc.trackPosition()
  win.once('ready-to-show', () => windowSvc.restorePosition())
  // Register the window service so profile:save can apply always_on_top/tray_enabled live.
  services.window = windowSvc

  ipcDisposeRef = registerIpc({ services, getWin: () => win })?.dispose ?? null
})

// Shutdown: persist chat history to session-cache.json so the next boot can
// summarize it (audit #2). The window-service close-when-not-hiding path calls
// the same flusher; createQuitFlush guards against a double write.
app.on('before-quit', () => {
  flushSessionCacheRef?.()
  // Stop the idle-chatter timer so no reply push fires during teardown.
  ipcDisposeRef?.()
  ipcDisposeRef = null
})

app.on('window-all-closed', () => app.quit())
