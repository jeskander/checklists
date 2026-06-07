import { useEffect, useMemo, useRef, useState } from 'react'
import { debounce } from '../lib/debounce'

/** Local input state while focused so Dexie/live-query re-renders don't reset the cursor. */
export function useDebouncedDraft(
  value: string,
  onChange: (value: string) => void,
  waitMs = 400
) {
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(value)
  const debouncedOnChange = useMemo(() => debounce(onChange, waitMs), [onChange, waitMs])

  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  useEffect(() => () => debouncedOnChange.cancel(), [debouncedOnChange])

  return {
    value: draft,
    onFocus: () => {
      focusedRef.current = true
    },
    onBlur: () => {
      focusedRef.current = false
      debouncedOnChange.flush()
      if (draft !== value) onChange(draft)
    },
    onChange: (next: string) => {
      setDraft(next)
      debouncedOnChange(next)
    },
  }
}
