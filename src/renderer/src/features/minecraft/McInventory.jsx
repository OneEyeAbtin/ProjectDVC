import { RefreshCw } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { botStatusLine, itemIcon } from './minecraftLogic.js'

// Inv tab: bot status strip + inventory list + manual refresh (sends the
// legacy %status / %inv raw commands).
export default function McInventory() {
  const status = useStore((s) => s.mcBotStatus)
  const items = useStore((s) => s.mcInventory)
  const connected = useStore((s) => s.mcConnected)

  function refresh() {
    useStore.getState().mcSendRaw('%status')
    useStore.getState().mcSendRaw('%inv')
  }

  return (
    <div className="mc-inv" role="tabpanel" aria-label="Minecraft inventory">
      <p className={'mc-status-line' + (status ? '' : ' idle')}>
        {status ? botStatusLine(status) : 'Status arrives after %status…'}
      </p>
      <ul className="mc-inv-list">
        {!connected && items.length === 0 && (
          <li className="mc-inv-empty">Connect ⛏ then press refresh to load inventory.</li>
        )}
        {connected && items.length === 0 && (
          <li className="mc-inv-empty">(inventory empty — press refresh)</li>
        )}
        {items.map((item, i) => {
          const name = String(item?.name ?? '?')
          const count = Number(item?.count) || 1
          return (
            <li key={`${name}-${i}`} className="mc-inv-item">
              <span aria-hidden="true">{itemIcon(name)}</span>
              <span className="mc-inv-name">{name.replace(/_/g, ' ')}</span>
              <span className="mc-inv-count">×{count}</span>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="btn ghost small mc-inv-refresh"
        aria-label="Refresh status and inventory"
        disabled={!connected}
        onClick={refresh}
      >
        <RefreshCw size={13} /> Refresh
      </button>
    </div>
  )
}
