import { Loader2, Pickaxe } from 'lucide-react'
import { useStore } from '../../state/store.js'

// Top-bar MC toggle: click connects (spinner until mc-status lands) or
// disconnects; green dot marks a live bot WS connection.
export default function McButton() {
  const connected = useStore((s) => s.mcConnected)
  const connecting = useStore((s) => s.mcConnecting)
  const label = connecting
    ? 'Connecting to Minecraft…'
    : connected
      ? 'Disconnect Minecraft'
      : 'Connect to Minecraft'

  function onClick() {
    const s = useStore.getState()
    if (s.mcConnecting) return
    if (s.mcConnected) s.mcDisconnect()
    else s.mcConnect()
  }

  return (
    <button
      type="button"
      className={'icon-btn mc-btn' + (connected ? ' live' : '')}
      title={label}
      aria-label={label}
      aria-pressed={connected}
      aria-busy={connecting || undefined}
      disabled={connecting}
      onClick={onClick}
    >
      {connecting ? <Loader2 size={15} className="mc-spin" aria-hidden="true" /> : <Pickaxe size={15} />}
      {connected && <span className="mc-dot" aria-hidden="true" />}
    </button>
  )
}
