import './DeleteRepeatInstanceDialog.css'

export type RepeatInstanceDeleteMode = 'one' | 'future' | 'cancel'

type Props = {
  blockTitle: string
  subtitle: string
  futureCount: number
  showFutureOption: boolean
  onChoose: (mode: RepeatInstanceDeleteMode) => void
  onDismiss: () => void
}

export function DeleteRepeatInstanceDialog({
  blockTitle,
  subtitle,
  futureCount,
  showFutureOption,
  onChoose,
  onDismiss,
}: Props) {
  const sessionLabel = futureCount === 1 ? 'event' : 'events'

  return (
    <div
      className="modal-overlay repeat-delete-overlay"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className="modal-sheet repeat-delete-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="repeat-delete-title">Delete {blockTitle}?</h2>
        <p className="repeat-delete-subtitle">{subtitle}</p>

        <div className="repeat-delete-actions">
          <button type="button" className="btn btn-primary" onClick={() => onChoose('one')}>
            This event only
          </button>
          {showFutureOption ? (
            <button type="button" className="btn" onClick={() => onChoose('future')}>
              This and all future events ({futureCount} {sessionLabel})
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
