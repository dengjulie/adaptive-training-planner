import type { FormEvent } from 'react'
import type { GoalInput, RaceDistance } from './api.ts'
import { addDays, RACE_LABELS, WEEKDAYS } from './format.ts'
import { defaultWindow, localToday } from './goal.ts'

const DISTANCES: RaceDistance[] = ['5k', '10k', 'half', 'marathon']


/**
 * The goal as a form. Controlled, so the AI intake can fill it in: whatever the conversation
 * drafted shows up here, and only this form's submit creates the plan.
 */
export function GoalForm({
  value,
  onChange,
  onSubmit,
  pending,
  submitLabel,
  children,
}: {
  value: GoalInput
  onChange: (goal: GoalInput) => void
  onSubmit: (goal: GoalInput) => void
  pending: boolean
  submitLabel: string
  children?: React.ReactNode
}) {
  const windowFor = (weekday: number) => value.timeWindows.find((w) => w.weekday === weekday)
  const setWindows = (timeWindows: GoalInput['timeWindows'], longRunWeekday = value.longRunWeekday) => {
    const sorted = [...timeWindows].sort((a, b) => a.weekday - b.weekday)
    // Keep the long run on a training day when its day is unticked.
    const long = sorted.some((w) => w.weekday === longRunWeekday) ? longRunWeekday : (sorted.at(-1)?.weekday ?? 6)
    onChange({ ...value, timeWindows: sorted, longRunWeekday: long })
  }
  const toggleDay = (weekday: number) => {
    const existing = windowFor(weekday)
    setWindows(
      existing ? value.timeWindows.filter((w) => w !== existing) : [...value.timeWindows, defaultWindow(weekday)],
    )
  }
  const setTime = (weekday: number, field: 'start' | 'end', time: string) =>
    setWindows(value.timeWindows.map((w) => (w.weekday === weekday ? { ...w, [field]: time } : w)))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(value)
  }
  const minDate = addDays(localToday(), 21)

  return (
    <form className="card goal-form" onSubmit={submit}>
      <fieldset>
        <legend>Race</legend>
        <div className="segmented" role="group" aria-label="Race distance">
          {DISTANCES.map((distance) => (
            <button
              key={distance}
              type="button"
              aria-pressed={value.raceDistance === distance}
              onClick={() => onChange({ ...value, raceDistance: distance })}
            >
              {RACE_LABELS[distance]}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Race day</span>
          <input
            type="date"
            required
            min={minDate}
            value={value.raceDate}
            onChange={(event) => onChange({ ...value, raceDate: event.target.value })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>When you can run</legend>
        <p className="small muted">
          Sessions go into these windows around your calendar’s busy times. Pick at least two days.
        </p>
        <table className="table availability">
          <thead>
            <tr>
              <th>Day</th>
              <th>From</th>
              <th>To</th>
              <th>Long run</th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((name, weekday) => {
              const window = windowFor(weekday)
              return (
                <tr key={name}>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={window !== undefined} onChange={() => toggleDay(weekday)} />
                      {name}
                    </label>
                  </td>
                  <td>
                    {window && (
                      <input
                        type="time"
                        aria-label={`${name} from`}
                        value={window.start}
                        onChange={(event) => setTime(weekday, 'start', event.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    {window && (
                      <input
                        type="time"
                        aria-label={`${name} to`}
                        value={window.end}
                        onChange={(event) => setTime(weekday, 'end', event.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    {window && (
                      <input
                        type="radio"
                        name="long-run"
                        aria-label={`Long run on ${name}`}
                        checked={value.longRunWeekday === weekday}
                        onChange={() => onChange({ ...value, longRunWeekday: weekday })}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </fieldset>

      {children}
      <div className="actions">
        <button type="submit" className="button primary" disabled={pending || value.timeWindows.length < 2}>
          {pending ? 'Building your plan…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
