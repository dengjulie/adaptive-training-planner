import { useMarkDone, type Plan, type PlanSession } from './api.ts'
import {
  addDays,
  formatDate,
  formatMinutes,
  formatTime,
  isHard,
  KIND_LABELS,
  PHASE_LABELS,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from './format.ts'

/** One week of the plan, a column per day. */
export function WeekView({
  plan,
  weekIndex,
  onWeekChange,
}: {
  plan: Plan
  weekIndex: number
  onWeekChange: (index: number) => void
}) {
  const week = plan.weeks[weekIndex]
  if (!week) return null
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.start, i))
  const byDay = new Map(plan.sessions.filter((s) => s.weekIndex === weekIndex).map((s) => [s.day, s]))
  const phase = `${PHASE_LABELS[week.phase]}${week.recovery ? ' · recovery week' : ''}`

  return (
    <section className="card week-card" aria-labelledby="week-heading">
      <div className="card-header week-header">
        <div className="week-nav">
          <button
            type="button"
            className="button subtle"
            aria-label="Previous week"
            disabled={weekIndex === 0}
            onClick={() => onWeekChange(weekIndex - 1)}
          >
            ‹
          </button>
          <div>
            <h2 id="week-heading">
              Week {weekIndex + 1} of {plan.weeks.length}
            </h2>
            <p className="small muted">
              {formatDate(days[0]!)} – {formatDate(days[6]!)} · {phase}
            </p>
          </div>
          <button
            type="button"
            className="button subtle"
            aria-label="Next week"
            disabled={weekIndex === plan.weeks.length - 1}
            onClick={() => onWeekChange(weekIndex + 1)}
          >
            ›
          </button>
        </div>
        <p className="small muted week-totals">
          {formatMinutes(week.plannedMinutes)} planned
          {week.actualMinutes > 0 && ` · ${formatMinutes(week.actualMinutes)} done`}
        </p>
      </div>
      <ol className="week-grid">
        {days.map((day, i) => (
          <DayCell key={day} day={day} weekday={i} session={byDay.get(day)} today={plan.today} />
        ))}
      </ol>
    </section>
  )
}

function DayCell({
  day,
  weekday,
  session,
  today,
}: {
  day: string
  weekday: number
  session: PlanSession | undefined
  today: string
}) {
  const markDone = useMarkDone()
  const isToday = day === today
  return (
    <li className={`day-cell${isToday ? ' today' : ''}${day < today ? ' past' : ''}`} aria-current={isToday ? 'date' : undefined}>
      <p className="day-name">
        <abbr title={WEEKDAYS[weekday]}>{WEEKDAYS_SHORT[weekday]}</abbr> {formatDate(day)}
      </p>
      {!session ? (
        <p className="small muted">Rest</p>
      ) : (
        <div className={`session-chip ${session.kind === 'rest' ? 'rest' : isHard(session.kind) ? 'hard' : 'easy'} ${session.status}`}>
          <p className="session-kind">{KIND_LABELS[session.kind]}</p>
          {session.kind !== 'rest' && session.kind !== 'race' && <p className="session-minutes">{session.minutes} min</p>}
          {session.startAt && session.status === 'planned' && <p className="small muted">{formatTime(session.startAt)}</p>}
          {session.slotStatus === 'no_slot' && session.status === 'planned' && <p className="small warn-text">No free slot</p>}
          {session.status === 'done' && (
            <p className="small ok-text">
              ✓ Done{session.actualMinutes !== null && ` · ${session.actualMinutes} min`}
            </p>
          )}
          {session.status === 'missed' && <p className="small muted">Missed</p>}
          {session.adjustment && (
            <p className="small adjusted" title={session.adjustment.reason}>
              Adjusted from {KIND_LABELS[session.base.kind].toLowerCase()}
              {session.base.kind !== 'race' && ` · ${session.base.minutes} min`}
            </p>
          )}
          {session.status === 'planned' && day < today && session.kind !== 'rest' && (
            <button type="button" className="link-button small" disabled={markDone.isPending} onClick={() => markDone.mutate(session.id)}>
              Mark done
            </button>
          )}
        </div>
      )}
    </li>
  )
}
