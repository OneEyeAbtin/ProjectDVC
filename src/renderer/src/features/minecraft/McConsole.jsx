import { useEffect, useRef, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { useStore } from '../../state/store.js'

// Console panel: mc-log lines (capped in the store) + raw input row.
// "% command" or "# chat" — text is sent exactly as typed; % entries are
// recallable with ↑/↓ (shell-style).
export default function McConsole() {
  const lines = useStore((s) => s.mcConsole)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)
  const stickRef = useRef(true)
  const histIdxRef = useRef(null)

  // QoL: stick to the bottom while reading the latest lines; a manual scroll
  // up pauses the chase until the user returns to the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [lines])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
  }

  function submit() {
    const text = draft.trim()
    if (!text) return
    useStore.getState().mcSendRaw(text)
    setDraft('')
    histIdxRef.current = null
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    const history = useStore.getState().mcCmdHistory
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const base = histIdxRef.current ?? history.length
      histIdxRef.current = Math.max(0, base - 1)
      setDraft(history[histIdxRef.current])
    } else if (e.key === 'ArrowDown' && histIdxRef.current !== null) {
      e.preventDefault()
      const next = histIdxRef.current + 1
      if (next >= history.length) {
        histIdxRef.current = null
        setDraft('')
      } else {
        histIdxRef.current = next
        setDraft(history[next])
      }
    }
  }

  return (
    <div className="mc-console" role="tabpanel" aria-label="Minecraft console">
      <div className="mc-log" ref={scrollRef} onScroll={onScroll}>
        {lines.length === 0 ? (
          <p className="mc-log-empty">Console quiet~ Connect ⛏ to see drone logs.</p>
        ) : (
          lines.map((entry) => (
            <p key={entry.id} className={`mc-line tone-${entry.tone}`}>
              {entry.text}
            </p>
          ))
        )}
      </div>
      <div className="mc-con-row">
        <input
          className="chat-input mc-con-input"
          aria-label="Minecraft console command"
          value={draft}
          placeholder="% command or # chat"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="send-btn" title="Send to bot" aria-label="Send to bot" onClick={submit}>
          <SendHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}
