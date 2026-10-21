/** Synthetic COROS activities for tests and the demo, shaped like parseSportRecords output. */
import type { CorosActivity } from '../../../src/integrations/coros/activities.ts'
import { addDays, weekdayOf, type IsoDate, type Weekday } from '../../../src/lib/dates.ts'
import { noise, seededRandom } from '../random.ts'

export type RunPattern = { weekday: Weekday; minutes: number; minutesPerKm: number }[]

export type SyntheticRunOptions = {
  start: IsoDate
  end: IsoDate
  /** The runs of a typical week. */
  pattern: RunPattern
  /** Days the runner skipped. */
  skip?: IsoDate[]
  /** Adds a strength session on this weekday, which isn't a run and must be ignored. */
  strengthWeekday?: Weekday
  seed?: number
}

const labelId = (day: IsoDate, n: number) => `9${day.replaceAll('-', '')}${String(n).padStart(9, '0')}`

export function syntheticRuns({
  start,
  end,
  pattern,
  skip = [],
  strengthWeekday,
  seed = 1,
}: SyntheticRunOptions): CorosActivity[] {
  const random = seededRandom(seed)
  const activities: CorosActivity[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) {
    // Draw for every day, skipped or not, so a skip doesn't change the other days' runs.
    const wobble = 1 + 0.08 * noise(random)
    if (skip.includes(day)) continue
    const run = pattern.find((p) => p.weekday === weekdayOf(day))
    const startTime = new Date(`${day}T14:00:00Z`)
    if (run) {
      const minutes = Math.round(run.minutes * wobble)
      activities.push({
        labelId: labelId(day, 1),
        sportType: 100,
        name: 'Run',
        date: day,
        startTime: startTime.toISOString(),
        endTime: new Date(startTime.getTime() + minutes * 60_000).toISOString(),
        durationSeconds: minutes * 60,
        distanceKm: Math.round((minutes / run.minutesPerKm) * 100) / 100,
        averageHeartRate: Math.round(run.minutesPerKm < 5.5 ? 162 : 145),
      })
    }
    if (strengthWeekday === weekdayOf(day)) {
      activities.push({
        labelId: labelId(day, 2),
        sportType: 402,
        name: 'Strength',
        date: day,
        startTime: startTime.toISOString(),
        endTime: new Date(startTime.getTime() + 45 * 60_000).toISOString(),
        durationSeconds: 45 * 60,
        distanceKm: null,
        averageHeartRate: 105,
      })
    }
  }
  return activities
}
