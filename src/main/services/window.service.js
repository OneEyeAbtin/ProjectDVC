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

// getConfig must be a lazy accessor (e.g. () => services.config) so the service
// always reads the CURRENT config instance — factory reset replaces services.config,
// and a captured stale instance would resurrect pre-reset save.json on window move.
export function createWindowService({ win, getConfig, onCloseToQuit, getWorkAreaForPoint }) {
  let tray = null
  let trayFailed = false
  let moveTimer = null
  let quitting = false

  // QoL-7: the tray's first row always reflects current visibility —
  // "Hide DVC" while the window shows, "Show DVC" while hidden — and the menu
  // is rebuilt on every visibility change (win 'show'/'hide' events).
  function rebuildTrayMenu() {
    if (!tray || trayFailed) return
    try {
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: win.isVisible() ? 'Hide DVC' : 'Show DVC',
            click: () => {
              if (win.isVisible()) win.hide()
              else {
                win.show()
                win.focus()
              }
            }
          },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() }
        ])
      )
    } catch (err) {
      console.warn('[dvc] tray menu rebuild failed:', String(err?.message ?? err))
    }
  }

  function ensureTray() {
    if (tray || trayFailed) return
    try {
      tray = new Tray(trayIcon())
      tray.setToolTip('Desktop Virtual Companion')
      rebuildTrayMenu()
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
    const cfg = getConfig().getConfig()
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
        const config = getConfig()
        const save = config.getSave()
        if (save.win_x === x && save.win_y === y) return
        config.patchSave({ win_x: x, win_y: y })
      }, 500)
    })
  }

  // Resolves the work area of the display containing (x, y) so multi-monitor
  // users get their saved placement back (audit #6). Negative coords are
  // legitimate on monitors left of/above the primary; getDisplayMatching
  // handles them. Falls back to the primary work area if matching fails.
  function workAreaFor(x, y) {
    if (getWorkAreaForPoint) return getWorkAreaForPoint(x, y)
    try {
      const display = screen.getDisplayMatching({ x, y, width: 1, height: 1 })
      if (display?.workArea) return display.workArea
    } catch {
      void 0
    }
    return screen.getPrimaryDisplay().workArea
  }

  function restorePosition() {
    const save = getConfig().getSave()
    const { win_x: x, win_y: y } = save
    if (!Number.isInteger(x) || !Number.isInteger(y)) return
    const wa = workAreaFor(x, y)
    const { width, height } = win.getBounds()
    const pos = clampToWorkarea(x, y, width, height, wa)
    win.setPosition(pos.x, pos.y)
  }

  app.on('before-quit', () => {
    quitting = true
  })

  win.on('show', rebuildTrayMenu)
  win.on('hide', rebuildTrayMenu)

  win.on('close', (event) => {
    if (quitting) return
    const cfg = getConfig().getConfig()
    if (cfg.hide_to_tray && cfg.tray_enabled && tray) {
      event.preventDefault()
      win.hide()
      return
    }
    // Closing without hide-to-tray means the app is going down — persist chat
    // history for next-boot summarization. Shared flusher with 'before-quit';
    // double writes are guarded inside the flusher itself.
    onCloseToQuit?.()
  })

  return { applySettings, trackPosition, restorePosition }
}
