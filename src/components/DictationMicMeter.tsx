import './DictationMicMeter.css'

export function DictationMicMeter({
  bars,
  processing,
}: {
  bars: number[]
  processing?: boolean
}) {
  return (
    <div className="dictation-meter-wrap" aria-hidden="true">
      <div className={`dictation-meter${processing ? ' dictation-meter--processing' : ''}`}>
        {bars.map((scale, i) => (
          <span
            key={i}
            className="dictation-meter-bar"
            style={{ transform: `scaleY(${processing ? 0.15 + (i % 3) * 0.05 : scale})` }}
          />
        ))}
      </div>
      <svg
        className={`dictation-meter-icon${processing ? ' dictation-meter-icon--processing' : ''}`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zM11 18.1v2.9h2v-2.9a7 7 0 01-7-7H4a9 9 0 0016 0h-2a7 7 0 01-7 7z" />
      </svg>
    </div>
  )
}
