import { useState } from 'react'
import type { RepeatUnit, TemplateRepeat } from '../lib/templateRepeat'
import {
  defaultTemplateRepeat,
  formatTemplateRepeat,
  normalizeTemplateRepeat,
  repeatDefaultsForUnit,
  repeatNeedsOnDay,
  weekdayLabel,
} from '../lib/templateRepeat'
import { TimeOnlyInput } from './TimeOnlyInput'
import './TemplateRepeatEditor.css'

type Props = {
  repeat: TemplateRepeat | undefined
  onChange: (repeat: TemplateRepeat | undefined) => void
}

const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'day' },
  { value: 'week', label: 'week' },
  { value: 'month', label: 'month' },
  { value: 'year', label: 'year' },
]

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function TemplateRepeatEditor({ repeat, onChange }: Props) {
  const enabled = Boolean(repeat)
  const [open, setOpen] = useState(enabled)

  const setEnabled = (on: boolean) => {
    if (on) {
      onChange(normalizeTemplateRepeat(repeat ?? defaultTemplateRepeat()))
      setOpen(true)
    } else {
      onChange(undefined)
    }
  }

  const patch = (partial: Partial<TemplateRepeat>) => {
    if (!repeat) return
    onChange(clampRepeat({ ...normalizeTemplateRepeat(repeat), ...partial }))
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
    onChange(clampRepeat(next))
  }

  const normalized = repeat ? normalizeTemplateRepeat(repeat) : undefined
  const preview = normalized ? formatTemplateRepeat(normalized) : null

  return (
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
            onChange={(e) => setEnabled(e.target.checked)}
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
                      <div className="repeat-weekdays" role="group" aria-label="Day of week">
                        {WEEKDAYS.map((day) => (
                          <button
                            key={day}
                            type="button"
                            className={`repeat-weekday${normalized.weekday === day ? ' repeat-weekday--active' : ''}`}
                            aria-pressed={normalized.weekday === day}
                            onClick={() => patch({ weekday: day })}
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
                <label className="repeat-row-label repeat-time-label">
                  Time
                  <TimeOnlyInput
                    className="field repeat-time-field"
                    timeHHMM={normalized.timeHHMM}
                    onChange={(timeHHMM) => patch({ timeHHMM })}
                  />
                </label>
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
  )
}

function clampRepeat(repeat: TemplateRepeat): TemplateRepeat {
  return normalizeTemplateRepeat(repeat)
}
