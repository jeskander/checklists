import { useUndo } from '../context/UndoContext'

export function Snackbar() {
  const { message, undo, dismiss } = useUndo()
  if (!message) return null

  return (
    <div className="snackbar" role="status">
      <span>{message}</span>
      <button type="button" className="snackbar-undo" onClick={undo}>
        Undo
      </button>
      <button type="button" className="btn btn-ghost btn-icon" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
