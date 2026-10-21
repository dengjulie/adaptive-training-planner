import { useMemo, useState } from 'react'
import { Legend } from '../components/ChartParts.tsx'
import { StackedBars, type StackLayer } from '../components/StackedBars.tsx'
import type { Plan, PlanWeek } from './api.ts'
import { formatDate, formatMinutes, PHASE_LABELS } from './format.ts'

const HOUR_STEPS = [60, 120, 180, 240]
const formatHours = (minutes: number) => `${minutes / 60}h`
const isLighter = (week: PlanWeek) => week.recovery || week.phase === 'taper'

/**
 * Planned minutes week by week, phases labeled underneath. Lighter weeks (recovery and taper)
 * stand apart from building weeks. Selecting a week shows it in the week view.
 */
export function PlanTimeline({
  plan,
  currentWeek,
  onSelectWeek,
}: {
  plan: Plan
  currentWeek: number
  onSelectWeek: (index: number) => void
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const days = useMemo(() => plan.weeks.map((w) => w.start), [plan.weeks])
  const layers = useMemo<StackLayer[]>(
    () => [
      {
        label: 'Building week',
        values: plan.weeks.map((w) => (isLighter(w) ? null : w.plannedMinutes)),
        color: 'var(--plan-week)',
      },
      {
        label: 'Recovery or taper week',
        values: plan.weeks.map((w) => (isLighter(w) ? w.plannedMinutes : null)),
        color: 'var(--plan-light-week)',
      },
    ],
    [plan.weeks],
  )
  const phases = useMemo(() => {
    const spans: { phase: PlanWeek['phase']; weeks: number }[] = []
    for (const week of plan.weeks) {
      const last = spans.at(-1)
      if (last?.phase === week.phase) last.weeks++
      else spans.push({ phase: week.phase, weeks: 1 })
    }
    return spans
  }, [plan.weeks])

  const shown = plan.weeks[activeIndex ?? currentWeek]
  const peak = Math.max(...plan.weeks.map((w) => w.plannedMinutes))

  return (
    <section className="card" aria-labelledby="timeline-heading">
      <div className="card-header">
        <h2 id="timeline-heading">The whole plan</h2>
        <Legend items={layers.map(({ label, color }) => ({ label, color }))} />
      </div>
      {shown && (
        <p className="small readout" aria-live="polite">
          <strong>Week {shown.index + 1}</strong> · {formatDate(shown.start)} · {PHASE_LABELS[shown.phase]}
          {shown.recovery && ' (recovery)'} · {formatMinutes(shown.plannedMinutes)} planned
          {shown.actualMinutes > 0 && ` · ${formatMinutes(shown.actualMinutes)} done`}
        </p>
      )}
      <StackedBars
        label={`Planned running per week: ${plan.weeks.length} weeks building to ${formatMinutes(peak)} at the peak, then a taper. Weekly values are in the table below.`}
        days={days}
        layers={layers}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={onSelectWeek}
        height={140}
        formatTick={formatHours}
        tickSteps={HOUR_STEPS}
      />
      <ol className="phase-strip" aria-label="Phases">
        {phases.map(({ phase, weeks }) => (
          <li key={phase} style={{ flexGrow: weeks }}>
            {PHASE_LABELS[phase]} <span className="muted">· {weeks} wk</span>
          </li>
        ))}
      </ol>
      <details>
        <summary>Weekly plan</summary>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Starts</th>
                <th>Phase</th>
                <th>Planned</th>
                <th>Done</th>
              </tr>
            </thead>
            <tbody>
              {plan.weeks.map((week) => (
                <tr key={week.index}>
                  <td>{week.index + 1}</td>
                  <td>{formatDate(week.start)}</td>
                  <td>
                    {PHASE_LABELS[week.phase]}
                    {week.recovery && ' (recovery)'}
                  </td>
                  <td>{formatMinutes(week.plannedMinutes)}</td>
                  <td>{week.actualMinutes > 0 ? formatMinutes(week.actualMinutes) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
