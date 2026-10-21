import type { OuraDaily } from '../../db/schema.ts'
import { addDays, type IsoDate } from '../../lib/dates.ts'

export type OuraMetric = 'readinessScore' | 'averageHrv' | 'restingHeartRate'
export type OuraValues = Pick<OuraDaily, 'day' | OuraMetric>

/**
 * Days before a day that its normal range is drawn from (README, "Baseline": rolling 30-day
 * ranges for readiness, HRV, and resting heart rate).
 */
export const BASELINE_WINDOW_DAYS = 30

/** Values the window needs before its range means anything: about two weeks of nights. */
export const BASELINE_MIN_VALUES = 14

/** A metric's normal range: its mean, give or take one standard deviation. */
export type NormalRange = { mean: number; low: number; high: number }

/**
 * The normal range a day is compared against, from the values on the BASELINE_WINDOW_DAYS days
 * before it. The day's own value is left out. Null while the window holds fewer than
 * BASELINE_MIN_VALUES values.
 */
export function normalRangeBefore(
  values: ReadonlyMap<IsoDate, number>,
  day: IsoDate,
): NormalRange | null {
  const window: number[] = []
  for (let back = 1; back <= BASELINE_WINDOW_DAYS; back++) {
    const value = values.get(addDays(day, -back))
    if (value !== undefined) window.push(value)
  }
  if (window.length < BASELINE_MIN_VALUES) return null

  const mean = window.reduce((sum, value) => sum + value, 0) / window.length
  const squaredDeviations = window.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  const deviation = Math.sqrt(squaredDeviations / (window.length - 1))
  return { mean, low: mean - deviation, high: mean + deviation }
}

function valuesByDay(stored: OuraValues[], metric: OuraMetric): Map<IsoDate, number> {
  const values = new Map<IsoDate, number>()
  for (const row of stored) {
    const value = row[metric]
    if (value !== null) values.set(row.day, value)
  }
  return values
}

export type OuraTrendDay = OuraValues & { normalRange: Record<OuraMetric, NormalRange | null> }

/**
 * Every day from `start` to `end`, oldest first, with each metric's value (null for days Oura has
 * nothing for) and the normal range going into that day. The first days' ranges come from the
 * stored days before `start`, as far as retention allows.
 */
export function trendDays(stored: OuraValues[], start: IsoDate, end: IsoDate): OuraTrendDay[] {
  const values: Record<OuraMetric, Map<IsoDate, number>> = {
    readinessScore: valuesByDay(stored, 'readinessScore'),
    averageHrv: valuesByDay(stored, 'averageHrv'),
    restingHeartRate: valuesByDay(stored, 'restingHeartRate'),
  }
  const days: OuraTrendDay[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push({
      day,
      readinessScore: values.readinessScore.get(day) ?? null,
      averageHrv: values.averageHrv.get(day) ?? null,
      restingHeartRate: values.restingHeartRate.get(day) ?? null,
      normalRange: {
        readinessScore: normalRangeBefore(values.readinessScore, day),
        averageHrv: normalRangeBefore(values.averageHrv, day),
        restingHeartRate: normalRangeBefore(values.restingHeartRate, day),
      },
    })
  }
  return days
}
