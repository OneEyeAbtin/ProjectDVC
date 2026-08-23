import { useEffect, useRef, useState } from 'react'

// Typewriter: appends one char every `speed` ms. `onDone` fires once per text.
// `onWord` is a Plan-2 placeholder for text lip-sync (alternating talking
// toggles on word boundaries); it receives true/false per word when provided.
export function useTypewriter(text, { speed = 18, onDone, onWord } = {}) {
  const [shown, setShown] = useState('')
  const [typing, setTyping] = useState(Boolean(text))
  const doneRef = useRef(onDone)
  const wordRef = useRef(onWord)
  doneRef.current = onDone
  wordRef.current = onWord

  useEffect(() => {
    if (!text) {
      setShown('')
      setTyping(false)
      return undefined
    }
    setShown('')
    setTyping(true)
    let i = 0
    let words = 0
    wordRef.current?.(false)
    const timer = setInterval(() => {
      i += 1
      setShown(text.slice(0, i))
      if (text[i - 1] === ' ') {
        words += 1
        wordRef.current?.(words % 2 === 1)
      }
      if (i >= text.length) {
        clearInterval(timer)
        setTyping(false)
        wordRef.current?.(false)
        doneRef.current?.(text)
      }
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])

  return { shown, typing }
}
