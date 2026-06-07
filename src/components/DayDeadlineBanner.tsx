import type { TaskDueOnDay } from '../lib/taskDeadline'
import { formatTaskDueMeta, formatTaskOverdueMeta } from '../lib/taskDeadline'
import './DayDeadlineBanner.css'

type Props = {
  variant: 'due' | 'overdue'
  tasks: TaskDueOnDay[]
  heading: string
}

export function DayDeadlineBanner({ variant, tasks, heading }: Props) {
  if (!tasks.length) return null

  return (
    <section
      className={`day-deadline-banner day-deadline-banner--${variant}`}
      aria-label={variant === 'overdue' ? 'Overdue tasks' : 'Tasks due'}
    >
      <h2 className="day-deadline-banner-heading">
        {heading}
        <span className="day-deadline-banner-count">{tasks.length}</span>
      </h2>
      <ul className="day-deadline-list">
        {tasks.map(({ item, listTitle }) => (
          <li key={item.id} className="day-deadline-item">
            <span className="day-deadline-item-title">{item.title || 'Untitled task'}</span>
            <span className="day-deadline-item-meta">
              {variant === 'overdue'
                ? formatTaskOverdueMeta(item, listTitle)
                : formatTaskDueMeta(item, listTitle)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
