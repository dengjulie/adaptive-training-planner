import { useState } from 'react'
import { useMe } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { useCreateGoal, type GoalInput } from './api.ts'
import { GoalChat, type GoalDraft } from './GoalChat.tsx'
import { GoalForm } from './GoalForm.tsx'
import { defaultGoal } from './goal.ts'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** The form with whatever the chat has pinned down so far; the rest stays as it was. */
function withDraft(goal: GoalInput, draft: GoalDraft): GoalInput {
  const windows = draft.timeWindows.filter(
    (w, i, all) =>
      Number.isInteger(w.weekday) &&
      w.weekday >= 0 &&
      w.weekday <= 6 &&
      CLOCK.test(w.start) &&
      CLOCK.test(w.end) &&
      all.findIndex((other) => other.weekday === w.weekday) === i,
  )
  const timeWindows = windows.length > 0 ? windows.sort((a, b) => a.weekday - b.weekday) : goal.timeWindows
  const longRun = draft.longRunWeekday ?? goal.longRunWeekday
  return {
    raceDistance: draft.raceDistance ?? goal.raceDistance,
    raceDate: draft.raceDate && ISO_DATE.test(draft.raceDate) ? draft.raceDate : goal.raceDate,
    timeWindows,
    longRunWeekday: timeWindows.some((w) => w.weekday === longRun) ? longRun : (timeWindows.at(-1)?.weekday ?? 6),
  }
}

/** Setting (or changing) the race goal the plan is built for. */
export function GoalSetup({
  current,
  onDone,
  onCancel,
}: {
  current?: GoalInput
  onDone: () => void
  onCancel?: () => void
}) {
  const [goal, setGoal] = useState<GoalInput>(() =>
    current
      ? {
          raceDistance: current.raceDistance,
          raceDate: current.raceDate,
          timeWindows: current.timeWindows,
          longRunWeekday: current.longRunWeekday,
        }
      : defaultGoal(),
  )
  const create = useCreateGoal()
  const { data: me } = useMe()
  const [filled, setFilled] = useState(false)

  return (
    <>
      <h1>{current ? 'Change your goal' : 'Set a race goal'}</h1>
      <p className="lede">
        {current
          ? 'Your sessions from today on are rebuilt for the new goal. Past sessions stay as they were.'
          : 'Pick a race and the times you can run. The plan starts from your recent COROS training and fits sessions around your calendar.'}
      </p>
      {me?.features.aiGoalIntake && (
        <GoalChat
          onDraft={(draft, complete) => {
            setGoal((current) => withDraft(current, draft))
            setFilled(complete)
          }}
        />
      )}
      {filled && (
        <p className="notice" role="status">
          The chat filled in the form below. Check it, then build your plan.
        </p>
      )}
      <GoalForm
        value={goal}
        onChange={setGoal}
        onSubmit={(input) => create.mutate(input, { onSuccess: onDone })}
        pending={create.isPending}
        submitLabel={current ? 'Rebuild my plan' : 'Build my plan'}
      >
        {create.error && <ErrorMessage error={create.error} />}
      </GoalForm>
      {onCancel && (
        <div className="actions">
          <button type="button" className="button subtle" onClick={onCancel}>
            Keep the current plan
          </button>
        </div>
      )}
    </>
  )
}
