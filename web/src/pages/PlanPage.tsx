import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { useCalendarSync, usePlan, useRunMorning, type MorningResult, type Plan } from '../plan/api.ts'
import { daysBetween, formatLongDate, formatMinutes, formatTime, RACE_LABELS } from '../plan/format.ts'
import { GoalSetup } from '../plan/GoalSetup.tsx'
import { PlanTimeline } from '../plan/PlanTimeline.tsx'
import { TodayCard } from '../plan/TodayCard.tsx'
import { WeekView } from '../plan/WeekView.tsx'

export function PlanPage() {
  const plan = usePlan()
  const [editing, setEditing] = useState(false)
  const [weekIndex, setWeekIndex] = useState<number | null>(null)
  const morning = useRunMorning()

  if (plan.isPending) return <p className="muted">Loading…</p>
  if (plan.isError) return <ErrorMessage error={plan.error} />
  if (!plan.data || editing) {
    return (
      <GoalSetup
        current={plan.data?.goal}
        onDone={() => {
          setEditing(false)
          setWeekIndex(null)
          morning.reset()
        }}
        onCancel={plan.data ? () => setEditing(false) : undefined}
      />
    )
  }

  const data = plan.data
  const currentWeek = Math.max(
    0,
    data.weeks.findLastIndex((w) => w.start <= data.today),
  )
  const daysToGo = daysBetween(data.today, data.goal.raceDate)

  return (
    <>
      <h1>
        {RACE_LABELS[data.goal.raceDistance]} · {formatLongDate(data.goal.raceDate)}
      </h1>
      <p className="lede">
        {daysToGo > 0 ? `${daysToGo} days to go` : daysToGo === 0 ? 'Race day' : 'Race done'} · week{' '}
        {currentWeek + 1} of {data.weeks.length}. <BaselineNote plan={data} />
      </p>

      <div className="toolbar">
        <div className="actions tight">
          <button type="button" className="button" disabled={morning.isPending} onClick={() => morning.mutate()}>
            {morning.isPending ? 'Checking…' : 'Run this morning’s check'}
          </button>
          <button type="button" className="button subtle" onClick={() => setEditing(true)}>
            Change goal
          </button>
        </div>
        <CalendarStatus plan={data} />
      </div>
      {morning.data && <MorningNotice result={morning.data} onDismiss={() => morning.reset()} />}
      {morning.error && <ErrorMessage error={morning.error} />}

      <div className="cards">
        <TodayCard plan={data} />
        <WeekView plan={data} weekIndex={weekIndex ?? currentWeek} onWeekChange={setWeekIndex} />
        <PlanTimeline plan={data} currentWeek={weekIndex ?? currentWeek} onSelectWeek={setWeekIndex} />
      </div>
    </>
  )
}

function BaselineNote({ plan }: { plan: Plan }) {
  if (!plan.baseline) {
    return (
      <>
        Without COROS history the plan starts gently; <Link to="/connections">connect COROS</Link> to
        start from your real training.
      </>
    )
  }
  const { weeklyMinutes, runsPerWeek } = plan.baseline
  return (
    <>
      Built from your last 8 weeks on COROS: {formatMinutes(weeklyMinutes)} a week over {runsPerWeek} runs.
    </>
  )
}

function CalendarStatus({ plan }: { plan: Plan }) {
  const sync = useCalendarSync()
  if (!plan.calendar.connected) {
    return (
      <p className="small muted">
        Calendar not connected · <Link to="/connections">Connect</Link>
      </p>
    )
  }
  const result = sync.data
  return (
    <p className="small muted calendar-status">
      {result?.status === 'failed'
        ? `Calendar sync failed: ${result.message}`
        : plan.calendar.syncedAt
          ? `On your Training calendar · synced ${formatTime(plan.calendar.syncedAt)}`
          : 'Not on your calendar yet'}{' '}
      <button type="button" className="link-button" disabled={sync.isPending} onClick={() => sync.mutate()}>
        {sync.isPending ? 'Syncing…' : 'Sync now'}
      </button>
    </p>
  )
}

function MorningNotice({ result, onDismiss }: { result: MorningResult; onDismiss: () => void }) {
  const parts = [
    result.done > 0 && `${result.done} session${result.done === 1 ? '' : 's'} ticked off from COROS`,
    result.missed > 0 && `${result.missed} missed`,
    result.adjusted > 0
      ? `${result.adjusted} adjusted for readiness`
      : 'no readiness changes',
  ].filter(Boolean)
  return (
    <div className="notice" role="status">
      <span>Morning check done: {parts.join(', ')}.</span>
      <button type="button" className="button subtle" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
