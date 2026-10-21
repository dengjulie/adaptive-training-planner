import { useState } from 'react'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { useCreateGoal, type GoalInput } from './api.ts'
import { GoalForm } from './GoalForm.tsx'
import { defaultGoal } from './goal.ts'

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

  return (
    <>
      <h1>{current ? 'Change your goal' : 'Set a race goal'}</h1>
      <p className="lede">
        {current
          ? 'Your sessions from today on are rebuilt for the new goal. Past sessions stay as they were.'
          : 'Pick a race and the times you can run. The plan starts from your recent COROS training and fits sessions around your calendar.'}
      </p>
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
