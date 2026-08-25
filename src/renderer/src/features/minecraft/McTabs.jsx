import { useStore } from '../../state/store.js'
import { visibleMcTabs } from './minecraftLogic.js'

// Tab row renders Chat always; the drone views only while connected (the
// store also auto-switches to Chat on disconnect so `active` stays in range).
export default function McTabs() {
  const active = useStore((s) => s.mcTab)
  const connected = useStore((s) => s.mcConnected)
  return (
    <nav className="mc-tabs" role="tablist" aria-label="Minecraft panels">
      {visibleMcTabs(connected).map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-label={`${tab.name} panel`}
          className={'mc-tab' + (active === tab.id ? ' active' : '')}
          onClick={() => useStore.getState().setMcTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
