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

// First-run nudge: shown once through the say pipeline when the brain is
// unconfigured (online mode, no API key, no local URL).
const BRAIN_HINT =
  '(Psst — I need a brain to think! Add an API key in Settings → AI/API, or switch brain mode to Offline in Settings → General~ [EMOTION: thinking] 💡)'

function stripEmotionTag(template) {
  let emotion = null
  const text = String(template ?? '')
    .replace(/\[EMOTION:\s*(\w+)\]/gi, (_, tag) => {
      emotion = tag.toLowerCase()
      return ''
    })
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
    let hintTimer = null
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

      // One-time brain hint: online mode selected but no cloud key configured
      // (local_api_url ships with a default value, so it is not "unconfigured").
      if (
        s.brainMode === 'online' &&
        !s.config?.online_api_key &&
        !s.hintBrainShown
      ) {
        hintTimer = setTimeout(() => {
          const cur = useStore.getState()
          if (cur.hintBrainShown || cur.thinking || cur.typing) return
          const { text, emotion } = stripEmotionTag(BRAIN_HINT)
          cur.say(text, emotion)
          window.dvc.invoke('profile:save', { hint_brain_shown: true }).catch(() => {})
        }, 5000)
      }
    }, delay)
    return () => {
      clearTimeout(t)
      clearTimeout(hintTimer)
    }
  }, [])

  return (
    <div className="companion">
      <TopBar />
      <Portrait />
      <ChatPanel />
    </div>
  )
}
