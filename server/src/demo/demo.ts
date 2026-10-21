/**
 * The demo account: synthetic data only, so the app can be tried (and developed) without a real
 * ring, watch, or calendar. Enabled by DEMO_MODE; seeded by src/scripts/seed-demo.ts.
 *
 * Only COROS-shaped data lives here. The demo's Oura days are written to the database by the seed
 * script, so this module stays free of Oura code and the AI goal intake may use it.
 */
import { syntheticRuns, type RunPattern } from '../../tests/fixtures/coros/synthetic.ts'
import type { User } from '../db/schema.ts'
import { env } from '../env.ts'
import type { CorosActivity } from '../integrations/coros/activities.ts'
import { addDays, weekdayOf, type IsoDate, type Weekday } from '../lib/dates.ts'

export const DEMO_EMAIL = 'demo@train-smarter.local'
export const DEMO_GOOGLE_SUB = 'demo'

export const isDemoUser = (user: Pick<User, 'email' | 'googleSub'>) =>
  env.DEMO_MODE && user.googleSub === DEMO_GOOGLE_SUB && user.email === DEMO_EMAIL

export type TrainingPattern = { trainingDays: Weekday[]; longRunWeekday: Weekday }

/** The demo runner's week, picked so `today` is a training day and the long run is later on. */
export function demoTrainingPattern(today: IsoDate): TrainingPattern {
  const weekday = weekdayOf(today)
  const at = (offset: number) => ((weekday + offset) % 7) as Weekday
  return { trainingDays: [at(0), at(2), at(4), at(5)], longRunWeekday: at(4) }
}

/**
 * Synthetic COROS runs on the pattern's training days up to yesterday: a long run, then easy and
 * faster runs alternating. One recent training day is skipped, so the plan shows a missed session.
 */
export function demoActivities(
  pattern: TrainingPattern,
  start: IsoDate,
  end: IsoDate,
  today: IsoDate,
): CorosActivity[] {
  const others = pattern.trainingDays.filter((d) => d !== pattern.longRunWeekday)
  const runs: RunPattern = [
    { weekday: pattern.longRunWeekday, minutes: 75, minutesPerKm: 6.1 },
    ...others.map((weekday, i) => ({
      weekday,
      minutes: i % 2 === 0 ? 45 : 40,
      minutesPerKm: i % 2 === 0 ? 6 : 5.2,
    })),
  ]
  const recentTrainingDays = Array.from({ length: 10 }, (_, i) => addDays(today, -(i + 1))).filter(
    (day) => pattern.trainingDays.includes(weekdayOf(day)),
  )
  const last = end < today ? end : addDays(today, -1)
  return syntheticRuns({
    start,
    end: last,
    pattern: runs,
    skip: recentTrainingDays.slice(1, 2),
    strengthWeekday: ((pattern.longRunWeekday + 2) % 7) as Weekday,
    seed: 7,
  })
}
