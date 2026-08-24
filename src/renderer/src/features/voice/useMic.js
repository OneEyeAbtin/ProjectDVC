import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store.js'
import { pickMimeType, levelToSegments } from './micHelpers.js'

const VU_THROTTLE_MS = 40

export function useMic({ setInput } = {}) {
  const [micState, setMicState] = useState('idle') // idle | recording | processing
  const [segments, setSegments] = useState(0)

  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const audioCtxRef = useRef(null)
  const rafRef = useRef(0)
  const lastVuRef = useRef(0)
  const generationRef = useRef(0)

  function fail(message) {
    useStore.getState().setError({ scope: 'voice', message })
  }

  const teardownCapture = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setSegments(0)
  }, [])

  const stop = useCallback(() => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    else teardownCapture()
  }, [teardownCapture])

  const start = useCallback(async () => {
    if (micState !== 'idle' || !setInput) return
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      fail('Microphone access denied — allow mic permission to use voice input.')
      return
    }
    streamRef.current = stream

    let recorder
    try {
      const mimeType = pickMimeType(
        (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
      )
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      teardownCapture()
      fail('Audio recording is not supported on this system.')
      return
    }
    recorderRef.current = recorder
    const mime = recorder.mimeType || 'audio/webm'

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const generation = generationRef.current
      const blob = new Blob(chunksRef.current.slice(), { type: mime })
      teardownCapture()
      setMicState('processing')
      blob
        .arrayBuffer()
        .then((buffer) => window.dvc.invoke('voice:stt-transcribe', { buffer, mime }))
        .then((res) => {
          if (generation !== generationRef.current) return
          if (res?.error) throw new Error(res.error)
          const text = String(res?.text ?? '').trim()
          if (!text) {
            fail('No speech detected in the recording.')
            return
          }
          // Transcript lands in the input; the panel owns the 600ms auto-send
          // (legacy parity) so it dies with the component, not this hook.
          setInput(text)
        })
        .catch((err) => {
          if (generation === generationRef.current) fail(String(err?.message ?? err))
        })
        .finally(() => {
          if (generation === generationRef.current) setMicState('idle')
        })
    }

    // Live level meter: AnalyserNode RMS → log-scaled segment count.
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = (now) => {
        rafRef.current = requestAnimationFrame(tick)
        if (now - lastVuRef.current < VU_THROTTLE_MS) return
        lastVuRef.current = now
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setSegments(levelToSegments(Math.sqrt(sum / data.length)))
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // Meter is cosmetic; recording continues without it.
    }

    setMicState('recording')
    recorder.start()
  }, [micState, setInput, teardownCapture])

  const toggle = useCallback(() => {
    if (micState === 'idle') void start()
    else if (micState === 'recording') stop()
  }, [micState, start, stop])

  useEffect(
    () => () => {
      generationRef.current += 1 // in-flight results are dropped after unmount
      cancelAnimationFrame(rafRef.current)
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      recorderRef.current?.state === 'recording' && recorderRef.current.stop()
      void audioCtxRef.current?.close().catch(() => {})
    },
    []
  )

  return { micState, segments, toggle }
}
