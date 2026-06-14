import { useEffect, useState } from 'react'
import type { RepeatUnit, TemplateRepeat } from '../lib/templateRepeat'
import {
  defaultTemplateRepeat,
  formatTemplateRepeat,
  getRepeatWeekdays,
  hasPerWeekdayTimes,
  normalizeTemplateRepeat,
  repeatDefaultsForUnit,
  repeatNeedsOnDay,
  repeatTimeForWeekday,
  weekdayLabel,
} from '../lib/templateRepeat'
import {
  countUntouchedRepeatInstances,
  listUpcomingInstancesForSource,
  pruneOnRepeatCancel,
  type RepeatCancelMode,
  type RepeatSource,
} from '../services/repeatInstances'
import { RepeatCancelDialog } from './RepeatCancelDialog'
import { TimeOnlyInput } from './TimeOnlyInput'
import './TemplateRepeatEditor.css'

export type BlockRepeatContext = {
  title: string
  defaultDurationMin: number
} & ({ kind: 'taskList'; id: string } | { kind: 'template'; id: string })

type Props = {
  repeat: TemplateRepeat | undefined
  source: BlockRepeatContext
  onChange: (repeat: TemplateRepeat | undefined) => void | Promise<void>
}

const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'day' },
  { value: 'week', label: 'week' },
  { value: 'month', label: 'month' },
  { value: 'year', label: 'year' },
]

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

function toRepeatSource(source: BlockRepeatContext): RepeatSource {
  if (source.kind === 'taskList') {
    return {
      kind: 'taskList',
      taskListId: source.id,
      defaultDurationMin: source.defaultDurationMin,
    }
  }
  return {
    kind: 'template',
    templateId: source.id,
    defaultDurationMin: source.defaultDurationMin,
  }
}

export function TemplateRepeatEditor({ repeat, source, onChange }: Props) {
  const enabled = Boolean(repeat)
  const [open, setOpen] = useState(enabled)
  const [cancelPrompt, setCancelPrompt] = useState<{ allCount: number; untouchedCount: number } | null>(
    null
  )

  const setEnabled = async (on: boolean) => {
    if (on) {
      await onChange(normalizeTemplateRepeat(repeat ?? defaultTemplateRepeat()))
      setOpen(true)
      return
    }

    if (!repeat) {
      await onChange(undefined)
      return
    }

    const repeatSource = toRepeatSource(source)
    const upcoming = await listUpcomingInstancesForSource(repeatSource)
    if (!upcoming.length) {
      await onChange(undefined)
      return
    }

    const normalized = normalizeTemplateRepeat(repeat)
    const untouchedCount = await countUntouchedRepeatInstances(repeatSource, normalized)
    setCancelPrompt({ allCount: upcoming.length, untouchedCount })
  }

  const finishCancel = async (mode: RepeatCancelMode) => {
    if (repeat) {
      await pruneOnRepeatCancel(toRepeatSource(source), normalizeTemplateRepeat(repeat), mode)
    }
    setCancelPrompt(null)
    await onChange(undefined)
  }

  const patch = (partial: Partial<TemplateRepeat>) => {
    if (!repeat) return
    void onChange(clampRepeat({ ...normalizeTemplateRepeat(repeat), ...partial }))
  }

  const setUnit = (unit: RepeatUnit) => {
    if (!repeat) return
    const base = normalizeTemplateRepeat(repeat)
    const next: TemplateRepeat = {
      every: base.every,
      unit,
      timeHHMM: base.timeHHMM,
      anchorDate: base.anchorDate,
      ...repeatDefaultsForUnit(unit),
    }
    void onChange(clampRepeat(next))
  }

  const normalized = repeat ? normalizeTemplateRepeat(repeat) : undefined
  const preview = normalized ? formatTemplateRepeat(normalized) : null
  const selectedWeekdays = normalized ? getRepeatWeekdays(normalized) : []
  const weeklyUnit = normalized?.unit === 'week'
  const [perDayTimes, setPerDayTimes] = useState(() =>
    normalized ? hasPerWeekdayTimes(normalized) : false
  )

  useEffect(() => {
    if (!normalized || normalized.unit !== 'week') {
      setPerDayTimes(false)
      return
    }
    if (hasPerWeekdayTimes(normalized)) setPerDayTimes(true)
  }, [repeat])

  const toggleWeekday = (day: number) => {
    if (!normalized) return
    const current = getRepeatWeekdays(normalized)
    let next: number[]
    if (current.includes(day)) {
      next = current.filter((d) => d !== day)
      if (!next.length) next = [day]
    } else {
      next = [...current, day].sort((a, b) => a - b)
    }
    patch({ weekdays: next })
  }

  const setPerDayTimesEnabled = (on: boolean) => {
    setPerDayTimes(on)
    if (!on) patch({ weekdayTimes: undefined })
  }

  const setWeekdayTime = (day: number, timeHHMM: string) => {
    if (!normalized) return
    const base = normalizeTemplateRepeat(normalized)
    const nextTimes = { ...base.weekdayTimes }
    if (timeHHMM === base.timeHHMM) delete nextTimes[day]
    else nextTimes[day] = timeHHMM
    patch({ weekdayTimes: Object.keys(nextTimes).length ? nextTimes : undefined })
  }

  const setDefaultTime = (timeHHMM: string) => {
    if (!normalized) return
    patch({ timeHHMM })
  }

  return (
    <>
      <section className={`repeat-editor${open ? ' repeat-editor--open' : ''}`}>
        <div className="repeat-editor-header">
          <button
            type="button"
            className="repeat-editor-expand"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="repeat-editor-panel"
          >
            <span className="repeat-editor-chevron" aria-hidden>
              ›
            </span>
            <span className="repeat-editor-expand-text">
              <span id="repeat-editor-heading" className="repeat-editor-title">
                Repeat
              </span>
              {!open && preview ? (
                <span className="repeat-editor-preview">{preview}</span>
              ) : null}
            </span>
          </button>

          <label
            className="repeat-switch"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              role="switch"
              className="repeat-switch-input"
              checked={enabled}
              onChange={(e) => void setEnabled(e.target.checked)}
              aria-label="Repeat on calendar"
            />
            <span className="repeat-switch-track" aria-hidden />
          </label>
        </div>

        {open ? (
          <div id="repeat-editor-panel" className="repeat-editor-panel">
            <div className="repeat-editor-body">
            {enabled && normalized ? (
              <div className="repeat-editor-fields">
                <p className="repeat-summary">{preview}</p>

                <div className="repeat-row repeat-row--inline">
                  <span className="repeat-row-label">Repeat every</span>
                  <div className="repeat-interval-group">
                    <input
                      type="number"
                      className="field repeat-every-field"
                      min={1}
                      max={99}
                      value={normalized.every}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        patch({ every: Number.isFinite(n) ? n : 1 })
                      }}
                      aria-label="Repeat interval count"
                    />
                    <select
                      className="field repeat-unit-select"
                      value={normalized.unit}
                      onChange={(e) => setUnit(e.target.value as RepeatUnit)}
                      aria-label="Repeat interval unit"
                    >
                      {UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {repeatNeedsOnDay(normalized.unit) ? (
                  <div className="repeat-row">
                    <span className="repeat-row-label">Repeat on</span>
                    <div className="repeat-row-controls repeat-on-controls">
                      {normalized.unit === 'week' ? (
                        <div className="repeat-weekdays" role="group" aria-label="Days of week">
                          {WEEKDAYS.map((day) => (
                            <button
                              key={day}
                              type="button"
                              className={`repeat-weekday${selectedWeekdays.includes(day) ? ' repeat-weekday--active' : ''}`}
                              aria-pressed={selectedWeekdays.includes(day)}
                              onClick={() => toggleWeekday(day)}
                            >
                              {weekdayLabel(day)}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {normalized.unit === 'month' ? (
                        <select
                          className="field repeat-day-select"
                          value={normalized.dayOfMonth ?? 1}
                          onChange={(e) => patch({ dayOfMonth: parseInt(e.target.value, 10) })}
                          aria-label="Day of month"
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {normalized.unit === 'year' ? (
                        <>
                          <select
                            className="field repeat-month-select"
                            value={normalized.month ?? 1}
                            onChange={(e) => patch({ month: parseInt(e.target.value, 10) })}
                            aria-label="Month"
                          >
                            {MONTHS.map((m) => (
                              <option key={m} value={m}>
                                {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                              </option>
                            ))}
                          </select>
                          <select
                            className="field repeat-day-select"
                            value={normalized.dayOfMonth ?? 1}
                            onChange={(e) => patch({ dayOfMonth: parseInt(e.target.value, 10) })}
                            aria-label="Day of month"
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="repeat-row">
                  <span className="repeat-row-label">Time</span>
                  {weeklyUnit ? (
                    <div className="repeat-time-controls">
                      <label className="repeat-per-day-toggle">
                        <input
                          type="checkbox"
                          checked={perDayTimes}
                          onChange={(e) => setPerDayTimesEnabled(e.target.checked)}
                        />
                        <span>Different time per day</span>
                      </label>

                      {perDayTimes ? (
                        <div className="repeat-day-times" role="group" aria-label="Time per day">
                          {selectedWeekdays.map((day) => (
                            <div key={day} className="repeat-day-time-row">
                              <span className="repeat-day-time-label">{weekdayLabel(day)}</span>
                              <TimeOnlyInput
                                className="field repeat-time-field"
                                timeHHMM={repeatTimeForWeekday(normalized, day)}
                                onChange={(timeHHMM) => setWeekdayTime(day, timeHHMM)}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <TimeOnlyInput
                          className="field repeat-time-field"
                          timeHHMM={normalized.timeHHMM}
                          onChange={setDefaultTime}
                        />
                      )}
                    </div>
                  ) : (
                    <TimeOnlyInput
                      className="field repeat-time-field"
                      timeHHMM={normalized.timeHHMM}
                      onChange={setDefaultTime}
                    />
                  )}
                </div>
              </div>
            ) : (
              <p className="repeat-hint">
                Turn on repeat to add this block to your calendar automatically.
              </p>
            )}
            </div>
          </div>
        ) : null}
      </section>

      {cancelPrompt ? (
        <RepeatCancelDialog
          blockTitle={source.title}
          allCount={cancelPrompt.allCount}
          untouchedCount={cancelPrompt.untouchedCount}
          onChoose={(mode) => void finishCancel(mode)}
          onDismiss={() => setCancelPrompt(null)}
        />
      ) : null}
    </>
  )
}

function clampRepeat(repeat: TemplateRepeat): TemplateRepeat {
  return normalizeTemplateRepeat(repeat)
}
