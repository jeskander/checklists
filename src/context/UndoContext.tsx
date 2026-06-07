import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type UndoAction = () => void | Promise<void>

type UndoContextValue = {
  showUndo: (message: string, action: UndoAction) => void
  message: string | null
  undo: () => void
  dismiss: () => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

const UNDO_MS = 6000

export function UndoProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const actionRef = useRef<UndoAction | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setMessage(null)
    actionRef.current = null
  }, [])

  const showUndo = useCallback(
    (msg: string, action: UndoAction) => {
      dismiss()
      setMessage(msg)
      actionRef.current = action
      timerRef.current = setTimeout(dismiss, UNDO_MS)
    },
    [dismiss]
  )

  const undo = useCallback(() => {
    const action = actionRef.current
    dismiss()
    void action?.()
  }, [dismiss])

  return (
    <UndoContext.Provider value={{ showUndo, message, undo, dismiss }}>
      {children}
    </UndoContext.Provider>
  )
}

export function useUndo() {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo must be used within UndoProvider')
  return ctx
}
