import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { debounce } from '../lib/debounce'

/** Local input state while focused so Dexie/live-query re-renders don't reset the cursor. */
export function useDebouncedDraft(
  value: string,
  onChange: (value: string) => void,
  waitMs = 400
) {
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(value)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const draftRef = useRef(draft)
  draftRef.current = draft
  const debouncedOnChange = useMemo(() => debounce(onChange, waitMs), [onChange, waitMs])

  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const commitPending = useCallback(() => {
    debouncedOnChange.flush()
    const next = draftRef.current
    if (next !== valueRef.current) onChangeRef.current(next)
  }, [debouncedOnChange])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') commitPending()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      commitPending()
    }
  }, [commitPending])

  return {
    value: draft,
    onFocus: () => {
      focusedRef.current = true
    },
    onBlur: () => {
      focusedRef.current = false
      commitPending()
    },
    onChange: (next: string) => {
      setDraft(next)
      debouncedOnChange(next)
    },
    commitNow: (next: string) => {
      debouncedOnChange.cancel()
      setDraft(next)
      onChange(next)
    },
  }
}
