import { Link } from 'react-router'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { useMarkDone, type Plan } from './api.ts'
import { formatLongDate, formatTime, sessionLabel, WEEKDAYS, weekdayOf } from './format.ts'

/** Today's session, what the morning's readiness check changed, and why. */
export function TodayCard({ plan }: { plan: Plan }) {
  const markDone = useMarkDone()
  const session = plan.sessions.find((s) => s.day === plan.today)
  const next = plan.sessions.find((s) => s.day > plan.today && s.kind !== 'rest')
  const changed = session?.adjustment ?? null
  const resting = !session || session.kind === 'rest'

  return (
    <section className="card today-card" aria-labelledby="today-heading">
      <div className="card-header">
        <h2 id="today-heading">Today</h2>
        <span className="small muted">{formatLongDate(plan.today)}</span>
      </div>

      <div className="today-session">
        {session && changed && (
          <p className="was">
            <s>{sessionLabel(session.base.kind, session.base.minutes)}</s>
          </p>
        )}
        <p className="now">{resting ? 'Rest day' : sessionLabel(session.kind, session.minutes)}</p>
        {session && !resting && (
          <p className="small muted">
            {session.startAt && session.endAt
              ? `${formatTime(session.startAt)} – ${formatTime(session.endAt)}`
              : session.slotStatus === 'no_slot'
                ? 'No free time in your window today'
                : 'Time not set yet'}
          </p>
        )}
        {!session && next && (
          <p className="small muted">
            Next: {sessionLabel(next.kind, next.minutes)} on {WEEKDAYS[weekdayOf(next.day)]}
          </p>
        )}
      </div>

      {changed && (
        <p className="adjustment-reason" role="note">
          <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5 14 13.5H2Z M8 6.5v3 M8 11.5v.01" />
          </svg>
          <span>{changed.reason}</span>
        </p>
      )}

      {session && !resting && (
        <div className="actions">
          {session.status === 'done' ? (
            <span className="pill ok">
              Done{session.actualMinutes !== null && ` · ${session.actualMinutes} min`}
            </span>
          ) : (
            <button type="button" className="button" disabled={markDone.isPending} onClick={() => markDone.mutate(session.id)}>
              Mark done
            </button>
          )}
        </div>
      )}
      {markDone.error && <ErrorMessage error={markDone.error} />}

      <ReadinessStrip plan={plan} adjusted={changed !== null} />
    </section>
  )
}

function ReadinessStrip({ plan, adjusted }: { plan: Plan; adjusted: boolean }) {
  if (!plan.readiness) {
    return (
      <p className="small muted readiness-strip">
        <Link to="/connections">Connect Oura</Link> and each morning’s session adjusts to your
        readiness.
      </p>
    )
  }
  const { days, range } = plan.readiness
  const today = days.at(-1)?.score ?? null
  const usual = range ? `usual ${Math.round(range.low)}–${Math.round(range.high)}` : 'normal range after 14 nights'
  return (
    <div className="readiness-strip">
      <Sparkline values={days.map((d) => d.score)} label={`Readiness over the last ${days.length} days`} />
      <p className="small muted">
        {today === null ? 'No readiness score yet today' : `Readiness ${today}`} · {usual}
        {today !== null && range && !adjusted && today >= range.low && ' · no changes needed'}
      </p>
    </div>
  )
}
