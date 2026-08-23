import { useEffect, useState } from 'react'

// Module-level memo cache per spec: `${prefix}|${emotion}` -> keyed dataURL.
const cache = new Map()

// Sprite URL resolution:
// - dev (http page): same-origin `/@fs/<abs path>` route — required so canvas
//   getImageData() is not tainted by cross-origin images. `server.fs.allow`
//   is set to the project root in electron.vite.config.js.
// - prod (file:// page): electron-vite copies assets/outfits to
//   out/renderer/sprites at build time, so a relative URL stays file://-local.
function spriteUrl(absPath) {
  const { protocol, origin } = window.location
  if (protocol === 'http:' || protocol === 'https:') {
    return `${origin}/@fs${encodeURI(absPath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
  }
  return `./sprites/${encodeURIComponent(absPath.split(/[\\/]/).pop())}`
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load sprite: ${src}`))
    img.src = src
  })
}

// Green-screen keyer, ported from legacy remove_green_screen (tol = 60):
// drop pixels where g > 255-tol and r < tol and b < tol.
async function keyedDataUrl(absPath) {
  const img = await loadImage(spriteUrl(absPath))
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = frame.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 1] > 195 && px[i] < 60 && px[i + 2] < 60) px[i + 3] = 0
  }
  ctx.putImageData(frame, 0, 0)
  return canvas.toDataURL('image/png')
}

export default function SpriteImage({ prefix = '', sprites, emotion = 'neutral', alt = '' }) {
  const [url, setUrl] = useState(null)
  const file =
    sprites?.[emotion] ?? sprites?.neutral ?? sprites?.happy ?? Object.values(sprites ?? {})[0] ?? null

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return undefined
    }
    const key = `${prefix}|${emotion}`
    const cached = cache.get(key)
    if (cached) {
      setUrl(cached)
      return undefined
    }
    let alive = true
    setUrl(null)
    keyedDataUrl(file)
      .then((dataUrl) => {
        cache.set(key, dataUrl)
        if (alive) setUrl(dataUrl)
      })
      .catch((err) => {
        console.warn('[dvc] sprite key failed, using raw image', err)
        if (alive) setUrl(spriteUrl(file))
      })
    return () => {
      alive = false
    }
  }, [file, prefix, emotion])

  if (!file) {
    return (
      <div className="sprite-fallback" role="img" aria-label={alt}>
        {(alt || '?').charAt(0).toUpperCase()}
      </div>
    )
  }
  return <img className="sprite" src={url ?? undefined} alt={alt} draggable={false} />
}
