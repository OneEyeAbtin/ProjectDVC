import { useEffect, useRef, useState } from 'react'
import { Mic, SendHorizontal } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { useTypewriter } from './useTypewriter.js'

// Ported from legacy: *asterisk actions* render as italic muted spans.
export function bubbleParts(text) {
  const nodes = []
  const re = /\*([^*]+)\*/g
  let last = 0
  let match
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(<span key={key++}>{text.slice(last, match.index)}</span>)
    nodes.push(
      <em key={key++} className="bubble-action">
        {match[1]}
      </em>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>)
  return nodes
}

export default function ChatPanel() {
  const bubble = useStore((s) => s.bubble)
  const typing = useStore((s) => s.typing)
  const thinking = useStore((s) => s.thinking)
  const error = useStore((s) => s.error)
  const historyCount = useStore((s) => s.historyCount)
  const maxHistory = useStore((s) => s.maxHistory)
  const sendMsg = useStore((s) => s.sendMsg)
  const completeType = useStore((s) => s.completeType)

  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  // Muted bubbles (boot "last response" replay) render statically.
  const { shown, typing: charTyping } = useTypewriter(bubble?.muted ? null : bubble?.text ?? null, {
    onDone: () => completeType()
  })

  const busy = thinking || typing || charTyping

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown, bubble, error])

  function submit() {
    const text = draft.trim()
    if (!text || busy) return
    sendMsg(text)
    setDraft('')
  }

  const displayText = bubble?.muted ? bubble.text : shown

  return (
    <section className="chat-panel">
      <div className="glass bubble-region" ref={scrollRef}>
        {error && (
          <div className="error-chip">
            ⚠ {error.message}
          </div>
        )}
        {thinking && !bubble && <em className="bubble-action">*thinking...</em>}
        {displayText && (
          <p className="bubble-text">
            {bubbleParts(displayText)}
            {charTyping && <span className="caret" aria-hidden="true" />}
          </p>
        )}
      </div>
      <div className="mem-label">
        MEM:{historyCount}/{maxHistory}
      </div>
      <div className="input-row">
        <input
          className="chat-input"
          value={draft}
          placeholder={busy ? '' : 'Say something...'}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" className="mic-btn" title="Voice (Plan 4)" disabled>
          <Mic size={16} />
        </button>
        <button type="button" className="send-btn" title="Send" disabled={busy} onClick={submit}>
          <SendHorizontal size={17} />
        </button>
      </div>
    </section>
  )
}
