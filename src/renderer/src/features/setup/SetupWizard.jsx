import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store.js'
import './setup.css'

export default function SetupWizard() {
  const questions = useStore((s) => s.setupQuestions)
  const completeSetup = useStore((s) => s.completeSetup)
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

  function advance() {
    const value = draft.trim()
    if (!value || !q || done) return
    const next = { ...answers, [q.key]: value }
    setAnswers(next)
    setDraft('')
    if (step + 1 < total) {
      setStep(step + 1)
    } else {
      setDone(true)
      setTimeout(() => completeSetup(next), 1400)
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
        {!done && q && (
          <>
            <input
              ref={inputRef}
              className="wiz-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') advance()
              }}
            />
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
