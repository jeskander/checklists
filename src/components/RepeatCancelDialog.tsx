import type { RepeatCancelMode } from '../services/repeatInstances'
import './RepeatCancelDialog.css'

type Props = {
  blockTitle: string
  allCount: number
  untouchedCount: number
  onChoose: (mode: RepeatCancelMode) => void
  onDismiss: () => void
}

export function RepeatCancelDialog({ blockTitle, allCount, untouchedCount, onChoose, onDismiss }: Props) {
  const sessionLabel = allCount === 1 ? 'session' : 'sessions'

  return (
    <div
      className="modal-overlay repeat-cancel-overlay"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className="modal-sheet repeat-cancel-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-cancel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="repeat-cancel-title">Turn off repeat?</h2>
        <p className="repeat-cancel-copy">
          Remove {allCount} upcoming <strong>{blockTitle}</strong> {sessionLabel} from your calendar,
          or keep them scheduled.
        </p>

        <div className="repeat-cancel-actions">
          <button type="button" className="btn btn-primary" onClick={() => onChoose('all')}>
            Remove all ({allCount})
          </button>
          {untouchedCount > 0 ? (
            <button type="button" className="btn" onClick={() => onChoose('untouched')}>
              Remove untouched only ({untouchedCount})
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => onChoose('keep')}>
            Keep on calendar
          </button>
        </div>
      </div>
    </div>
  )
}
