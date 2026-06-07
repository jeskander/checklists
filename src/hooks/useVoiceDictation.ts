import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceDictationPhase = 'idle' | 'listening' | 'processing'

const BAR_COUNT = 16
const MAX_NETWORK_RETRIES = 3

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function emptyBars(): number[] {
  return Array.from({ length: BAR_COUNT }, () => 0.1)
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isVoiceDictationSupported(): boolean {
  return getSpeechRecognitionCtor() != null
}

export function useVoiceDictation() {
  const [phase, setPhase] = useState<VoiceDictationPhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<number[]>(emptyBars)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalTranscriptRef = useRef('')
  const latestTranscriptRef = useRef('')
  const phaseRef = useRef(phase)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const meterRafRef = useRef(0)
  const barsRef = useRef(bars)
  const intentionalStopRef = useRef(false)
  const sessionActiveRef = useRef(false)
  const networkRetriesRef = useRef(0)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopWaiterRef = useRef<((text: string) => void) | null>(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(meterRafRef.current)
    meterRafRef.current = 0
    barsRef.current = emptyBars()
    setBars(emptyBars())
    void audioCtxRef.current?.close()
    audioCtxRef.current = null
  }, [])

  const stopStream = useCallback(() => {
    stopMeter()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [stopMeter])

  const cleanupRecognition = useCallback(() => {
    recognitionRef.current = null
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    stopMeter()
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)

    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      if (phaseRef.current !== 'listening') return
      analyser.getByteFrequencyData(data)

      const step = Math.max(1, Math.floor(data.length / BAR_COUNT))
      const next = emptyBars()

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0
        const startIdx = i * step
        for (let j = 0; j < step && startIdx + j < data.length; j++) {
          sum += data[startIdx + j]
        }
        const raw = sum / step / 255
        const boosted = Math.min(1, raw * 2.4)
        const prev = barsRef.current[i] ?? 0.1
        next[i] = Math.max(0.1, prev * 0.55 + boosted * 0.45)
      }

      barsRef.current = next
      setBars(next)
      meterRafRef.current = requestAnimationFrame(tick)
    }

    meterRafRef.current = requestAnimationFrame(tick)
  }, [stopMeter])

  const bindRecognition = useCallback(
    (recognition: SpeechRecognitionLike) => {
      recognition.onresult = (event) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscriptRef.current += piece
          } else {
            interim += piece
          }
        }
        const full = (finalTranscriptRef.current + interim).trim()
        latestTranscriptRef.current = full
        setTranscript(full)
      }

      recognition.onerror = (event) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return

        if (
          event.error === 'network' &&
          phaseRef.current === 'listening' &&
          !intentionalStopRef.current &&
          networkRetriesRef.current < MAX_NETWORK_RETRIES
        ) {
          networkRetriesRef.current += 1
          clearRestartTimer()
          restartTimerRef.current = setTimeout(() => {
            if (phaseRef.current !== 'listening' || intentionalStopRef.current) return
            const Ctor = getSpeechRecognitionCtor()
            if (!Ctor) return
            try {
              const next = new Ctor()
              next.continuous = true
              next.interimResults = true
              next.lang = navigator.language || 'en-GB'
              bindRecognition(next)
              next.start()
              recognitionRef.current = next
            } catch {
              setError('Speech recognition lost connection — release and try again')
            }
          }, 400)
          return
        }

        if (event.error === 'network') {
          setError('Speech needs internet (Chrome uses Google servers). Check your connection.')
          return
        }

        setError(
          event.error === 'not-allowed'
            ? 'Microphone permission denied'
            : `Speech error: ${event.error}`
        )
      }

      recognition.onend = () => {
        if (phaseRef.current === 'listening') {
          const full = finalTranscriptRef.current.trim() || latestTranscriptRef.current
          latestTranscriptRef.current = full
          setTranscript(full)
        }

        if (stopWaiterRef.current) {
          const text = latestTranscriptRef.current.trim() || finalTranscriptRef.current.trim()
          stopWaiterRef.current(text)
          stopWaiterRef.current = null
          return
        }

        if (intentionalStopRef.current || phaseRef.current !== 'listening') {
          cleanupRecognition()
          return
        }

        // Chrome stops recognition periodically even in continuous mode — restart.
        clearRestartTimer()
        restartTimerRef.current = setTimeout(() => {
          if (phaseRef.current !== 'listening' || intentionalStopRef.current) return
          const Ctor = getSpeechRecognitionCtor()
          if (!Ctor) return
          try {
            const next = new Ctor()
            next.continuous = true
            next.interimResults = true
            next.lang = navigator.language || 'en-GB'
            bindRecognition(next)
            next.start()
            recognitionRef.current = next
          } catch {
            cleanupRecognition()
          }
        }, 120)
      }
    },
    [cleanupRecognition]
  )

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser')
      return false
    }

    setError(null)
    setTranscript('')
    finalTranscriptRef.current = ''
    latestTranscriptRef.current = ''
    intentionalStopRef.current = false
    sessionActiveRef.current = true
    networkRetriesRef.current = 0
    clearRestartTimer()

    void (async () => {
      try {
        if (!streamRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          streamRef.current = stream
          startMeter(stream)
        }

        const recognition = new Ctor()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = navigator.language || 'en-GB'
        bindRecognition(recognition)
        recognition.start()
        recognitionRef.current = recognition
        setPhase('listening')
      } catch (err) {
        sessionActiveRef.current = false
        stopStream()
        const denied =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        setError(denied ? 'Microphone permission denied' : 'Could not start microphone')
        cleanupRecognition()
      }
    })()

    return true
  }, [bindRecognition, cleanupRecognition, startMeter, stopStream])

  const waitUntilListening = useCallback((timeoutMs = 2500) => {
    return new Promise<boolean>((resolve) => {
      if (phaseRef.current === 'listening') {
        resolve(true)
        return
      }
      if (!sessionActiveRef.current) {
        resolve(false)
        return
      }
      const started = Date.now()
      const tick = () => {
        if (phaseRef.current === 'listening') {
          resolve(true)
          return
        }
        if (!sessionActiveRef.current || Date.now() - started >= timeoutMs) {
          resolve(false)
          return
        }
        window.setTimeout(tick, 50)
      }
      tick()
    })
  }, [])

  const stopListening = useCallback(() => {
    intentionalStopRef.current = true
    sessionActiveRef.current = false
    clearRestartTimer()

    return new Promise<string>((resolve) => {
      const finish = (text: string) => {
        stopWaiterRef.current = null
        cleanupRecognition()
        stopStream()
        const trimmed = text.trim()
        latestTranscriptRef.current = trimmed
        setTranscript(trimmed)
        resolve(trimmed)
      }

      const fallback =
        latestTranscriptRef.current.trim() || finalTranscriptRef.current.trim()

      const recognition = recognitionRef.current
      if (!recognition) {
        finish(fallback)
        return
      }

      stopWaiterRef.current = finish
      const timeoutId = window.setTimeout(() => finish(fallback), 2000)

      stopWaiterRef.current = (text: string) => {
        window.clearTimeout(timeoutId)
        finish(text || fallback)
      }

      try {
        recognition.stop()
      } catch {
        try {
          recognition.abort()
        } catch {
          // ignore
        }
        window.clearTimeout(timeoutId)
        finish(fallback)
      }
    })
  }, [cleanupRecognition, stopStream])

  const setProcessing = useCallback(() => setPhase('processing'), [])

  const reset = useCallback(() => {
    intentionalStopRef.current = true
    sessionActiveRef.current = false
    stopWaiterRef.current = null
    clearRestartTimer()
    const recognition = recognitionRef.current
    if (recognition) {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
    }
    cleanupRecognition()
    stopStream()
    setPhase('idle')
    setTranscript('')
    setError(null)
    finalTranscriptRef.current = ''
    latestTranscriptRef.current = ''
  }, [cleanupRecognition, stopStream])

  const isSessionActive = useCallback(() => sessionActiveRef.current, [])

  useEffect(() => () => reset(), [reset])

  return {
    phase,
    transcript,
    error,
    bars,
    startListening,
    stopListening,
    waitUntilListening,
    isSessionActive,
    setProcessing,
    reset,
    setError,
  }
}

const LONG_PRESS_MS = 450

export function useLongPress(
  onTap: () => void,
  onLongPressStart: () => void,
  onLongPressEnd: () => void
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressActiveRef = useRef(false)
  const suppressTapRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const pointerDown = useCallback(() => {
    suppressTapRef.current = false
    longPressActiveRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      longPressActiveRef.current = true
      suppressTapRef.current = true
      onLongPressStart()
    }, LONG_PRESS_MS)
  }, [onLongPressStart])

  const pointerUp = useCallback(() => {
    clearTimer()
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false
      onLongPressEnd()
      return
    }
  }, [onLongPressEnd])

  const click = useCallback(
    (e: React.MouseEvent) => {
      if (suppressTapRef.current) {
        e.preventDefault()
        suppressTapRef.current = false
        return
      }
      onTap()
    },
    [onTap]
  )

  const contextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return { pointerDown, pointerUp, pointerCancel: pointerUp, click, contextMenu }
}
