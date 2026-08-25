import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store.js'
import { projectBlips, RADAR_WORLD_RADIUS } from './minecraftLogic.js'

// Canvas port of legacy _RadarWidget: 32-block world radius, 3 rings,
// crosshairs, white bot dot, red hostile / cyan player blips (closer = bigger).
// Purely data-driven — no animation loop, so it is reduced-motion safe by
// construction; it only unmounts/pauses when the tab hides or MC disconnects.
export default function McRadar() {
  const entities = useStore((s) => s.mcRadar)
  const connected = useStore((s) => s.mcConnected)
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth || 220
    const h = canvas.clientHeight || 170
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cx = w / 2
    const cy = h / 2
    const radius = Math.max(10, Math.min(cx, cy) - 8)

    if (!connected) {
      ctx.fillStyle = 'rgba(120, 150, 120, 0.55)'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('⛏ Not connected', cx, cy)
      return undefined
    }

    // Disc + rings + crosshairs (legacy greens).
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.fill()
    for (const frac of [0.33, 0.66, 1]) {
      ctx.beginPath()
      ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0, 255, 80, 0.24)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(cx - radius, cy)
    ctx.lineTo(cx + radius, cy)
    ctx.moveTo(cx, cy - radius)
    ctx.lineTo(cx, cy + radius)
    ctx.strokeStyle = 'rgba(0, 255, 80, 0.18)'
    ctx.stroke()

    // Bot dot.
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fill()

    // Entity blips, scaled by distance.
    for (const blip of projectBlips(entities, radius, RADAR_WORLD_RADIUS)) {
      ctx.beginPath()
      ctx.arc(cx + blip.x, cy + blip.y, blip.dot, 0, Math.PI * 2)
      ctx.fillStyle = blip.kind === 'player' ? 'rgba(0, 210, 255, 0.88)' : 'rgba(255, 60, 60, 0.88)'
      ctx.fill()
    }
    return undefined
  }, [entities, connected])

  return (
    <div className="mc-radar" role="tabpanel" aria-label="Minecraft radar">
      <canvas ref={canvasRef} className="mc-radar-canvas" aria-label="Radar scope" role="img" />
      <p className="mc-radar-legend">
        <span className="legend-dot hostile" aria-hidden="true" /> hostile ·
        <span className="legend-dot player" aria-hidden="true" /> player · 32 blocks · you are the white dot
      </p>
    </div>
  )
}
