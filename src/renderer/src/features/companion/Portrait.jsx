import { useStore } from '../../state/store.js'
import SpriteImage from './SpriteImage.jsx'

export default function Portrait() {
  const outfit = useStore((s) => s.outfit)
  const emotion = useStore((s) => s.emotion)
  const transientEmotion = useStore((s) => s.transientEmotion)
  const petName = useStore((s) => s.petName)
  const outfits = useStore((s) => s.outfits)

  // 'talking'/'fullbody' are render-state only; they override the sprite
  // without becoming the canonical (persisted) emotion.
  const shownEmotion = transientEmotion ?? emotion
  const entry = outfits.find((o) => o.name === outfit || o.prefix === outfit) ?? outfits[0]

  return (
    <section className="portrait">
      <SpriteImage
        prefix={entry?.prefix ?? ''}
        sprites={entry?.sprites}
        emotion={shownEmotion}
        alt={petName}
      />
      <span className="glass chip badge-outfit">{entry?.name ?? outfit}</span>
      <span className="glass chip badge-emotion">{shownEmotion}</span>
    </section>
  )
}
