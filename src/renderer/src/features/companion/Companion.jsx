import { useEffect } from 'react'
import { useStore } from '../../state/store.js'
import TopBar from './TopBar.jsx'
import Portrait from './Portrait.jsx'
import ChatPanel from './ChatPanel.jsx'
import './companion.css'

// Legacy parity (legacy/core/main.py::_greet): when a session summary exists,
// acknowledge the previous session instead of the persona greeting.
const SESSION_SUMMARY_GREETING =
  "*looks up* Oh, {name}'s back~ Last time... {summary}... [EMOTION: happy] 💫"

function resolveGreeting(template, userName, petName) {
  let emotion = null
  const text = String(template ?? '')
    .replace(/\[EMOTION:\s*(\w+)\]/gi, (_, tag) => {
      emotion = tag.toLowerCase()
      return ''
    })
    .replace(/\{name\}/g, userName)
    .replace(/\{pet\}/g, petName)
    .trim()
  return { text, emotion }
}

export default function Companion() {
  // Boot greeting: replay last response faded, then greet after 2.5s.
  // Persona-specific templates arrive via app:init; generic line is the fallback.
  useEffect(() => {
    const st = useStore.getState()
    if (st.lastResponse) st.showMuted(st.lastResponse)
    const delay = st.lastResponse ? 2500 : 400
    const t = setTimeout(() => {
      const s = useStore.getState()
      const summary = typeof s.sessionSummary === 'string' ? s.sessionSummary.trim() : ''
      let template
      if (summary) {
        template = SESSION_SUMMARY_GREETING.replace('{summary}', summary.slice(0, 80))
      } else {
        template = s.greetings?.[s.persona]
      }
      if (template) {
        const { text, emotion } = resolveGreeting(template, s.userName, s.petName)
        s.say(text, emotion)
      } else {
        s.say(`Hey ${s.userName}! I'm ${s.petName}! ✨`, 'happy')
      }
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
