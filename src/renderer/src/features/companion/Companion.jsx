import { useEffect } from 'react'
import { useStore } from '../../state/store.js'
import TopBar from './TopBar.jsx'
import Portrait from './Portrait.jsx'
import ChatPanel from './ChatPanel.jsx'
import './companion.css'

export default function Companion() {
  // Boot greeting: replay last response faded, then greet after 2.5s
  // (greetings live in main-process data, so v1 uses a static local fallback).
  useEffect(() => {
    const st = useStore.getState()
    if (st.lastResponse) st.showMuted(st.lastResponse)
    const delay = st.lastResponse ? 2500 : 400
    const t = setTimeout(() => {
      const s = useStore.getState()
      s.say(`Hey ${s.userName}! I'm ${s.petName}! ✨`, 'happy')
    }, delay)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="companion">
      <TopBar />
      <Portrait />
      <ChatPanel />
    </div>
  )
}
