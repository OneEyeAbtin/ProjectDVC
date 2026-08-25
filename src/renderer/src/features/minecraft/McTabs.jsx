import { useStore } from '../../state/store.js'

// Bottom segmented tab row above the chat input (legacy parity: Chat /
// Console / Radar / Inv). Tab 0 is the normal chat bubble view.
const TABS = [
  { id: 0, label: '💬 Chat', name: 'Chat' },
  { id: 1, label: '📟 Console', name: 'Console' },
  { id: 2, label: '🛰 Radar', name: 'Radar' },
  { id: 3, label: '🎒 Inv', name: 'Inventory' }
]

export default function McTabs() {
  const active = useStore((s) => s.mcTab)
  return (
    <nav className="mc-tabs" role="tablist" aria-label="Minecraft panels">
      {TABS.map((tab) => (
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
