import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Mic, RotateCcw, SendHorizontal, Square, X } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { playSfx } from '../../lib/sfx.js'
import { useMic } from '../voice/useMic.js'
import { SEGMENT_COUNT } from '../voice/micHelpers.js'
import { useTypewriter } from './useTypewriter.js'
import McTabs from '../minecraft/McTabs.jsx'
import McConsole from '../minecraft/McConsole.jsx'
import McRadar from '../minecraft/McRadar.jsx'
import McInventory from '../minecraft/McInventory.jsx'

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
  const regenerate = useStore((s) => s.regenerate)
  const lastUserText = useStore((s) => s.lastUserText)
  const completeType = useStore((s) => s.completeType)
  const dismissError = useStore((s) => s.dismissError)
  const mcTab = useStore((s) => s.mcTab)

  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef(null)
  const scrollRef = useRef(null)

  // Voice input: transcript fills the input, then auto-sends (legacy parity).
  // The send timer lives here so it dies with the panel, not inside the hook.
  const sendTimer = useRef(0)
  useEffect(() => () => clearTimeout(sendTimer.current), [])
  const { micState, segments, toggle: micToggle } = useMic({
    setInput: (text) => {
      setDraft(text)
      clearTimeout(sendTimer.current)
      sendTimer.current = setTimeout(() => useStore.getState().sendMsg(text), 600)
    }
  })

  // Muted bubbles (boot "last response" replay) render statically.
  const { shown, typing: charTyping } = useTypewriter(bubble?.muted ? null : bubble?.text ?? null, {
    onDone: () => completeType(),
    onTick: (i) => {
      if (i % 3 === 0) playSfx('blip')
    },
    // lip_sync_text: alternate talking↔neutral per word (store skips the
    // toggle while TTS audio is playing — that loop wins).
    onWord: (talking) => useStore.getState().textLipSync(talking)
  })

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

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

  async function copyReply() {
    const text = bubble?.text ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      useStore.getState().setError({ scope: 'clipboard', message: String(err?.message ?? err) })
    }
  }

  const displayText = bubble?.muted ? bubble.text : shown

  return (
    <section className="chat-panel">
      {error && (
        <div className="error-chip" role="alert">
          <span className="error-chip-msg">⚠ {error.message}</span>
          <button
            type="button"
            className="chip-dismiss"
            aria-label="Dismiss"
            onClick={dismissError}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className={'glass bubble-region' + (mcTab !== 0 ? ' is-hidden' : '')} ref={scrollRef}>
        {thinking && !bubble && (
          <em className="bubble-action thinking-indicator">
            thinking
            <span className="think-dots" aria-hidden="true">
              <span className="think-dot" />
              <span className="think-dot" />
              <span className="think-dot" />
            </span>
          </em>
        )}
        {displayText && (
          <p className="bubble-text">
            {bubbleParts(displayText)}
            {charTyping && <span className="caret" aria-hidden="true" />}
          </p>
        )}
      </div>
      {mcTab === 1 && <McConsole />}
      {mcTab === 2 && <McRadar />}
      {mcTab === 3 && <McInventory />}
      <div className={'mem-label' + (mcTab !== 0 ? ' is-hidden' : '')}>
        MEM:{historyCount}/{maxHistory}
      </div>
      <McTabs />
      <div className="input-row">
        <input
          className="chat-input"
          aria-label="Message"
          value={draft}
          placeholder={busy ? '' : 'Say something...'}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            // Shell-style recall: empty input + ArrowUp brings back the last
            // sent message (only when idle; the input is disabled while busy).
            else if (e.key === 'ArrowUp' && draft === '' && !busy && lastUserText) {
              e.preventDefault()
              setDraft(lastUserText)
            }
          }}
        />
        {micState === 'recording' && (
          <div className="vu-meter" aria-hidden="true">
            {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
              <span
                key={i}
                className={
                  'vu-seg' +
                  (i < segments ? ` lit vu-${i < 4 ? 'g' : i < 6 ? 'y' : 'r'}` : '')
                }
              />
            ))}
          </div>
        )}
        <button
          type="button"
          className={'mic-btn' + (micState === 'recording' ? ' recording' : '')}
          title={micState === 'idle' ? 'Voice input' : micState === 'recording' ? 'Stop recording' : 'Processing…'}
          aria-label={micState === 'idle' ? 'Start voice input' : micState === 'recording' ? 'Stop recording' : 'Processing…'}
          disabled={micState === 'processing'}
          onClick={() => micToggle()}
        >
          {micState === 'recording' ? <Square size={14} /> : <Mic size={16} />}
        </button>
        <button type="button" className="send-btn" title="Send" disabled={busy} onClick={submit}>
          <SendHorizontal size={17} />
        </button>
        <button
          type="button"
          className="chat-mini-btn"
          title="Regenerate reply"
          aria-label="Regenerate reply"
          disabled={busy || !lastUserText}
          onClick={() => regenerate()}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          className="chat-mini-btn"
          title="Copy reply"
          aria-label="Copy reply"
          disabled={busy || !displayText}
          onClick={copyReply}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </section>
  )
}
