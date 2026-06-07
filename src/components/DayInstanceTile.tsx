import { useState, useEffect, type MouseEvent } from 'react'
import type { DayInstance, DayInstanceItem } from '../db/types'
import { ProgressBackground } from './ProgressBackground'
import { taskProgress } from '../lib/completion'
import { timeProgressForInstance } from '../lib/progress'
import { formatScheduleSubtitle } from '../lib/schedule'
import './DayInstanceTile.css'

type Props = {
  instance: DayInstance
  items: DayInstanceItem[]
  onOpen: () => void
  onDelete: () => void
  variant?: 'default' | 'split'
}

export function DayInstanceTile({ instance, items, onOpen, onDelete, variant = 'default' }: Props) {
  const [, tick] = useState(0)
  const taskPct = taskProgress(items)
  const timePct = timeProgressForInstance(instance)
  const subtitle = formatScheduleSubtitle(instance.durationMin, instance.scheduledStartMs)

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <article
      className={['day-tile', variant === 'split' ? 'day-tile--split' : ''].filter(Boolean).join(' ')}
    >
      <ProgressBackground taskPct={taskPct} timePct={timePct} />
      <div
        className="day-tile-inner"
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        role="button"
        tabIndex={0}
        aria-label={`Open ${instance.title}`}
      >
        <div className="day-tile-titles">
          <h2 className="day-tile-title">{instance.title || 'Untitled'}</h2>
          <p className="day-tile-schedule">
            {instance.sourceTaskListId ? 'Task session · ' : ''}
            {subtitle}
          </p>
        </div>
        <div className="day-tile-actions" onClick={stop}>
          <button
            type="button"
            className="btn btn-ghost btn-icon tile-action tile-action-delete"
            onClick={onDelete}
            title="Remove"
            aria-label="Remove block"
          >
            ×
          </button>
        </div>
      </div>
    </article>
  )
}
