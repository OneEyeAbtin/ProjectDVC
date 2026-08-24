import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store.js'
import './setup.css'

export default function SetupWizard() {
  const questions = useStore((s) => s.setupQuestions)
  const completeSetup = useStore((s) => s.completeSetup)
  const error = useStore((s) => s.error)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [draft, setDraft] = useState('')
  const [done, setDone] = useState(false)
  const inputRef = useRef(null)

  const total = questions.length
  const q = total > 0 ? questions[step] : null
  const percent = done ? 100 : Math.round((step / Math.max(total, 1)) * 100)

  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  function finalize(finalAnswers) {
    setDone(true)
    setTimeout(() => completeSetup(finalAnswers), 1400)
  }

  function advance() {
    const value = draft.trim()
    if (!value || !q || done) return
    const next = { ...answers, [q.key]: value }
    setAnswers(next)
    setDraft('')
    if (step + 1 < total) {
      setStep(step + 1)
    } else {
      finalize(next)
    }
  }

  // Backend tolerates missing keys ('setup:complete' filters undefined/skip),
  // so skipping just advances without recording an answer.
  function skip() {
    if (!q || done) return
    setDraft('')
    if (step + 1 < total) {
      setStep(step + 1)
    } else {
      finalize(answers)
    }
  }

  return (
    <div className="wizard">
      <div className="glass wizard-card">
        <div className="wiz-emoji" role="img" aria-hidden="true">
          {done ? '🎉' : (q?.emoji ?? '✨')}
        </div>
        {q && !done && <h2 className="wiz-question">{q.q}</h2>}
        {done && <h2 className="wiz-question">All done!</h2>}
        {error && (
          <div className="error-chip" role="alert">
            ⚠ {error.message}
          </div>
        )}
        {!done && q && (
          <>
            <input
              ref={inputRef}
              className="wiz-input"
              aria-label={q.q}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') advance()
              }}
            />
            <button
              type="button"
              className="btn ghost small wiz-skip"
              aria-label={`Skip question ${step + 1}`}
              onClick={skip}
            >
              Skip
            </button>
            <div
              className="wiz-progress"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="wiz-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="wiz-counter">
              {step + 1} of {total}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
