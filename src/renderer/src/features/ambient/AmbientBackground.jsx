import { useEffect, useRef } from 'react'
import './ambient.css'

const STAR_COUNT = 28
// Every Nth star tints with var(--acc1); the rest stay white.
const ACCENT_EVERY = 4

function createStars(width, height) {
  return Array.from({ length: STAR_COUNT }, (_, i) => ({
    baseX: Math.random() * width,
    y: Math.random() * height,
    // 0.5-1px radius → 1-2px diameter dots.
    r: 0.5 + Math.random(),
    vy: 3 + Math.random() * 7, // px/s upward drift
    wobbleAmp: 2 + Math.random() * 6,
    wobbleFreq: 0.4 + Math.random() * 0.8, // Hz-ish
    phase: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.6 + Math.random() * 1.4,
    twinklePhase: Math.random() * Math.PI * 2,
    accent: i % ACCENT_EVERY === 0
  }))
}

export default function AmbientBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const shell = canvas?.parentElement
    if (!canvas || !shell || !canvas.getContext) return undefined
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let stars = []
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

    function resize() {
      const rect = shell.getBoundingClientRect()
      // Cap DPR at 2 — beyond that the fill cost outweighs visual gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!stars.length) stars = createStars(width, height)
      for (const s of stars) {
        if (s.baseX > width) s.baseX = Math.random() * width
        if (s.y > height) s.y = Math.random() * height
      }
    }

    // `animate=false` paints one static frame (reduced motion); otherwise the
    // stars' live positions/phases are used with a twinkle alpha.
    function paint(now, animate) {
      ctx.clearRect(0, 0, width, height)
      const t = now / 1000
      for (const s of stars) {
        const x = s.baseX + Math.sin(s.phase) * s.wobbleAmp
        ctx.globalAlpha = animate
          ? 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.twinkleSpeed * Math.PI * 2 + s.twinklePhase))
          : 0.55
        ctx.fillStyle = s.accent ? accent : '#ffffff'
        ctx.beginPath()
        ctx.arc(x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    function frame(now) {
      if (!running || disposed) return
      raf = requestAnimationFrame(frame)
      if (!last) last = now
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      for (const s of stars) {
        s.y -= s.vy * dt
        s.phase += s.wobbleFreq * dt * Math.PI * 2
        if (s.y < -2) {
          s.y = height + 2
          s.baseX = Math.random() * width
        }
      }
      paint(now, true)
    }

    function start() {
      if (running || reduceMotion) return
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
      else start()
    }

    if (reduceMotion) {
      // Static single paint: stars visible, zero per-frame work.
      paint(0, false)
      return () => {
        disposed = true
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    const ro = new ResizeObserver(() => {
      readColors()
      resize()
    })
    ro.observe(shell)

    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="ambient" aria-hidden="true">
      <div className="aurora">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <canvas ref={canvasRef} className="starfield" aria-hidden="true" />
    </div>
  )
}
