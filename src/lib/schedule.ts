import { formatDuration } from './duration'
import { formatTime24h } from './scheduleTime'

export interface Schedulable {
  id: string
  durationMin: number
  scheduledStartMs: number
}

export interface ScheduleSlot {
  id: string
  start: Date
  end: Date
  label: string
}

/** Subtitle under the title — duration and window only (no repeated name). */
export function formatScheduleSubtitle(durationMin: number, scheduledStartMs: number): string {
  const start = new Date(scheduledStartMs)
  const end = new Date(scheduledStartMs + durationMin * 60_000)
  return `${formatDuration(durationMin)} - ${formatTime24h(start)}–${formatTime24h(end)}`
}

export function formatInstanceSchedule(
  title: string,
  durationMin: number,
  scheduledStartMs: number
): string {
  return `${title} · ${formatScheduleSubtitle(durationMin, scheduledStartMs)}`
}

export function computeSchedule(
  instances: Schedulable[],
  titleById: Record<string, string>
): ScheduleSlot[] {
  const sorted = [...instances].sort((a, b) => a.scheduledStartMs - b.scheduledStartMs)

  return sorted.map((inst) => {
    const start = new Date(inst.scheduledStartMs)
    const end = new Date(inst.scheduledStartMs + inst.durationMin * 60_000)
    const title = titleById[inst.id] ?? 'Block'
    return {
      id: inst.id,
      start,
      end,
      label: formatInstanceSchedule(title, inst.durationMin, inst.scheduledStartMs),
    }
  })
}
