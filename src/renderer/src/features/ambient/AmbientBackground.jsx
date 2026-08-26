import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store.js'
import {
  resolveParticleTheme,
  sanitizeParticleTheme,
  setSpriteScale
} from './particleThemes.js'
import { applySpeed, sanitizeAnimationSpeed } from './animationSpeed.js'
import './ambient.css'

// Every Nth star tints with var(--acc1); the rest stay white (stars theme).
const ACCENT_EVERY = 4

export default function AmbientBackground() {
  const canvasRef = useRef(null)
  // start/stop handles published by the animation effect below, so the
  // uiBlocking effect can pause/resume the particle rAF loop.
  const controlsRef = useRef(null)
  // While any overlay/menu is open the ambient animation pauses entirely:
  // glass backdrop-filter would otherwise re-composite its blur every frame
  // against a moving background (expensive, and pointless while covered).
  const uiBlocked = useStore((s) => s.settingsOpen || s.statsOpen || s.contextMenuOpen)
  // Selected in Settings → General → Background; persisted via draft→Save,
  // delivered here through config pushes. Unknown/garbage falls back to stars.
  const particleTheme = sanitizeParticleTheme(useStore((s) => s.config?.particle_theme))
  // Ambient motion multiplier (0.25×–3×): scales particle sim dt per tick
  // (velocity AND every accumulated pulse phase — nothing reads absolute
  // time) and drives the aurora orbs' CSS duration via --ambient-speed.
  const animSpeed = sanitizeAnimationSpeed(useStore((s) => s.config?.animation_speed))
  // Latest speed for the animation effect below: a slider change must apply
  // per tick WITHOUT restarting the rAF loop (same pattern as blockedRef).
  const speedRef = useRef(animSpeed)
  speedRef.current = animSpeed
  // Latest blocked state for the animation effect below: a theme switch must
  // consult it at setup time without adding uiBlocked to that effect's deps
  // (block/unblock is owned by the pause/resume effect, not a restart trigger).
  const blockedRef = useRef(uiBlocked)
  blockedRef.current = uiBlocked

  useEffect(() => {
    const canvas = canvasRef.current
    const shell = canvas?.parentElement
    if (!canvas || !shell || !canvas.getContext) return undefined
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const def = resolveParticleTheme(particleTheme)
    let particles = []
    let width = 1
    let height = 1
    let raf = 0
    let last = 0
    let running = false
    let disposed = false
    let accent = '#ff6b9d'

    function readColors() {
      accent = getComputedStyle(shell).getPropertyValue('--acc1').trim() || accent
    }

    function spawnAll() {
      particles = Array.from({ length: def.count }, () =>
        def.spawn(width, height)
      )
    }

    function resize() {
      const rect = shell.getBoundingClientRect()
      // Cap DPR at 1.5 — beyond that the full-canvas fill cost outweighs the
      // visual gain on soft-edged particles (44% fewer pixels than 2×), and
      // dot sprites rasterize at this scale too.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setSpriteScale(dpr)
      if (!particles.length) spawnAll()
      for (const p of particles) {
        if (p.x > width) p.x = Math.random() * width
        if (p.y > height) p.y = Math.random() * height
      }
    }

    // `animate=false` paints one static frame (reduced motion); each theme's
    // draw picks a mid alpha instead of its live pulse/twinkle value.
    // Optional `def.link` paints pair-connection lines UNDER the dots
    // (constellation) before the per-particle pass runs.
    function paint(now, animate) {
      ctx.clearRect(0, 0, width, height)
      const t = now / 1000
      def.link?.(ctx, particles, t, animate, accent)
      for (let i = 0; i < particles.length; i++) {
        def.draw(ctx, particles[i], t, animate, accent, i % ACCENT_EVERY === 0)
      }
      ctx.globalAlpha = 1
    }

    function frame(now) {
      if (!running || disposed) return
      raf = requestAnimationFrame(frame)
      if (!last) last = now
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      // Speed multiplier scales per-frame velocity AND progress (age, phase,
      // tumble — everything dt-driven) without restarting the loop.
      const dtScaled = applySpeed(dt, speedRef.current)
      for (const p of particles) def.step(p, dtScaled, width, height)
      paint(now, true)
    }

    function start() {
      if (running || reduceMotion || particleTheme === 'none') return
      running = true
      last = 0
      if (!raf) raf = requestAnimationFrame(frame)
    }

    function stop() {
      running = false
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    readColors()
    resize()

    function onVisibility() {
      if (document.hidden) stop()
      else if (!blockedRef.current) start()
    }

    if (particleTheme === 'none') {
      // 'None' = no particles under ANY motion preference: leave the canvas
      // cleared and skip both the loop and the static reduced-motion frame.
      ctx.clearRect(0, 0, width, height)
      return () => {
        disposed = true
      }
    }

    if (reduceMotion) {
      // Static single paint: particles visible, zero per-frame work.
      paint(0, false)
      return () => {
        disposed = true
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    controlsRef.current = { start, stop }
    // A theme switch landing while an overlay covers the shell (settings/
    // stats/context menu open) must NOT kick the loop — the unblock path
    // resumes it via controls.start() when the last blocker closes.
    if (!blockedRef.current && !document.hidden) start()

    const ro = new ResizeObserver(() => {
      readColors()
      resize()
    })
    ro.observe(shell)

    return () => {
      disposed = true
      stop()
      controlsRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
    }
    // Theme switch = clean restart: the whole system (particles + loop +
    // listeners) rebuilds for the new behavior set.
  }, [particleTheme])

  // Pause/resume on overlay open/close: freeze the orb keyframes via CSS and
  // halt the particle rAF loop via the controls above. The document-hidden
  // handler stays authoritative for tab visibility; start() is a no-op while
  // running, so resume only re-kicks the loop when it was actually stopped.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const layer = canvasRef.current?.parentElement
    if (uiBlocked) {
      controls.stop()
      layer?.classList.add('ambient-paused')
    } else {
      layer?.classList.remove('ambient-paused')
      if (!document.hidden) controls.start()
    }
  }, [uiBlocked])

  return (
    <div className="ambient" style={{ '--ambient-speed': animSpeed }} aria-hidden="true">
      <div className="aurora">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <canvas ref={canvasRef} className="starfield" aria-hidden="true" />
    </div>
  )
}
