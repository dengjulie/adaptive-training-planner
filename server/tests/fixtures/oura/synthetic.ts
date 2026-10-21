/**
 * Synthetic Oura days for tests and the demo. Nothing here comes from a real ring: CLAUDE.md
 * forbids reading real Oura data during development.
 */
import { normalRangeBefore, type OuraValues } from '../../../src/integrations/oura/baseline.ts'
import { addDays, type IsoDate } from '../../../src/lib/dates.ts'
import { noise, seededRandom } from '../random.ts'

export type SyntheticOuraOptions = {
  /** The last day generated. */
  today: IsoDate
  /** How many days, ending `today`. */
  days?: number
  /**
   * How many days ending `today` are planted below their normal range: about 1.5 standard
   * deviations under the mean, so they're low without being very low (adapt.ts).
   */
  lowDays?: number
  seed?: number
}

export function syntheticOuraDays({ today, days = 60, lowDays = 0, seed = 1 }: SyntheticOuraOptions) {
  const random = seededRandom(seed)
  const rows: OuraValues[] = Array.from({ length: days }, (_, i) => ({
    day: addDays(today, i - days + 1),
    // Spreads close to a real ring's: readiness varies by about ±5 from night to night.
    readinessScore: Math.round(80 + 15 * noise(random)),
    averageHrv: Math.round((55 + 18 * noise(random)) * 10) / 10,
    restingHeartRate: Math.round(50 + 5 * noise(random)),
  }))

  // Planted oldest first, so each low day's range already includes the low days before it.
  for (let i = rows.length - lowDays; i < rows.length; i++) {
    const row = rows[i]!
    const scores = new Map(rows.slice(0, i).map((r) => [r.day, r.readinessScore!]))
    const range = normalRangeBefore(scores, row.day)
    if (!range) throw new Error('syntheticOuraDays needs 14 days of history before a low day')
    const deviation = range.mean - range.low
    row.readinessScore = Math.floor(range.mean - 1.5 * deviation)
    row.averageHrv = 38
    row.restingHeartRate = 57
  }
  return rows
}
