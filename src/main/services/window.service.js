import { app, Menu, nativeImage, screen, Tray } from 'electron'

const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAVUlEQVR4nO3OyREAIAgEQfJPGhPwAAV8MFu172kRZpiK6s2/REMw0XEXIituQmTHj4jegKr4EgEAAAAAAAB8B1QipnEAVYhtPBthimchXPEozFO0zQZyXkQt5eseWgAAAABJRU5ErkJggg=='

let cachedIcon = null

function trayIcon() {
  if (!cachedIcon) cachedIcon = nativeImage.createFromDataURL(ICON_DATA_URL)
  return cachedIcon
}

export function clampToWorkarea(x, y, w, h, wa) {
  const maxX = Math.max(wa.x, wa.x + wa.width - w)
  const maxY = Math.max(wa.y, wa.y + wa.height - h)
  return {
    x: Math.min(Math.max(Number(x), wa.x), maxX),
    y: Math.min(Math.max(Number(y), wa.y), maxY)
  }
}

export function createWindowService({ win, config }) {
  let tray = null
  let trayFailed = false
  let moveTimer = null
  let quitting = false

  function ensureTray() {
    if (tray || trayFailed) return
    try {
      tray = new Tray(trayIcon())
      tray.setToolTip('Desktop Virtual Companion')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Show DVC',
            click: () => {
              win.show()
              win.focus()
            }
          },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() }
        ])
      )
    } catch (err) {
      console.warn('[dvc] tray unavailable, continuing without it:', String(err?.message ?? err))
      trayFailed = true
      tray = null
    }
  }

  function destroyTray() {
    if (!tray) return
    try {
      tray.destroy()
    } catch {
      void 0
    }
    tray = null
  }

  function applySettings() {
    const cfg = config.getConfig()
    if (!win.isDestroyed()) win.setAlwaysOnTop(Boolean(cfg.always_on_top))
    if (cfg.tray_enabled) ensureTray()
    else destroyTray()
  }

  function trackPosition() {
    win.on('move', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        if (win.isDestroyed()) return
        const [x, y] = win.getPosition()
        const save = config.getSave()
        if (save.win_x === x && save.win_y === y) return
        config.patchSave({ win_x: x, win_y: y })
      }, 500)
    })
  }

  function restorePosition() {
    const save = config.getSave()
    const { win_x: x, win_y: y } = save
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return
    const wa = screen.getPrimaryDisplay().workArea
    const { width, height } = win.getBounds()
    const pos = clampToWorkarea(x, y, width, height, wa)
    win.setPosition(pos.x, pos.y)
  }

  app.on('before-quit', () => {
    quitting = true
  })

  win.on('close', (event) => {
    if (quitting) return
    const cfg = config.getConfig()
    if (cfg.hide_to_tray && cfg.tray_enabled && tray) {
      event.preventDefault()
      win.hide()
    }
  })

  return { applySettings, trackPosition, restorePosition }
}
