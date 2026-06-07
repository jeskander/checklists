import './ProgressBackground.css'

type Props = {
  taskPct: number
  timePct: number
}

export function ProgressBackground({ taskPct, timePct }: Props) {
  return (
    <div className="progress-bg" aria-hidden>
      <div className="progress-layer progress-time" style={{ width: `${timePct}%` }} />
      <div className="progress-layer progress-task" style={{ width: `${taskPct}%` }} />
    </div>
  )
}
