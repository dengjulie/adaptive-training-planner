import { describe, expect, it } from 'vitest'
import { addDays, type IsoDate } from '../../lib/dates.ts'
import { normalRangeBefore, trendDays, type OuraValues } from './baseline.ts'

/** Values on the `count` days before `day`, nearest first. */
const before = (day: IsoDate, count: number, valueFor: (back: number) => number) =>
  new Map(Array.from({ length: count }, (_, i) => [addDays(day, -(i + 1)), valueFor(i + 1)]))

const stored = (day: IsoDate, values: Partial<OuraValues> = {}): OuraValues => ({
  day,
  readinessScore: null,
  averageHrv: null,
  restingHeartRate: null,
  ...values,
})

describe('normalRangeBefore', () => {
  const day = '2026-03-31'

  it('is the mean give or take one standard deviation of the 30 days before', () => {
    // Alternating 40 and 60: mean 50, sample standard deviation sqrt(30 * 100 / 29).
    const values = before(day, 30, (back) => (back % 2 === 0 ? 40 : 60))
    const range = normalRangeBefore(values, day)
    expect(range?.mean).toBe(50)
    expect(range?.low).toBeCloseTo(50 - Math.sqrt(3000 / 29))
    expect(range?.high).toBeCloseTo(50 + Math.sqrt(3000 / 29))
  })

  it('leaves out the day itself and anything older than 30 days', () => {
    const values = before(day, 30, (back) => (back % 2 === 0 ? 40 : 60))
    values.set(day, 1000)
    values.set(addDays(day, -31), 1000)
    expect(normalRangeBefore(values, day)?.mean).toBe(50)
  })

  it('needs 14 values in the window, wherever the gaps are', () => {
    const everyOtherDay = (count: number) =>
      new Map([...before(day, count * 2, () => 50)].filter((_, i) => i % 2 === 0))
    expect(normalRangeBefore(everyOtherDay(13), day)).toBeNull()
    expect(normalRangeBefore(everyOtherDay(14), day)).toEqual({ mean: 50, low: 50, high: 50 })
  })
})

describe('trendDays', () => {
  it('lists every day from start to end, oldest first, with gaps as nulls', () => {
    const days = trendDays(
      [stored('2026-03-03', { readinessScore: 70 }), stored('2026-03-01', { readinessScore: 80 })],
      '2026-03-01',
      '2026-03-03',
    )
    expect(days.map(({ day, readinessScore }) => [day, readinessScore])).toEqual([
      ['2026-03-01', 80],
      ['2026-03-02', null],
      ['2026-03-03', 70],
    ])
  })

  it('gives each metric its own range, using days before the start but not listing them', () => {
    const end = '2026-03-31'
    const history = [...before(end, 20, () => 0).keys()].map((day, i) =>
      stored(day, { readinessScore: 80, averageHrv: i < 5 ? 45 : null }),
    )
    const days = trendDays(history, end, end)
    expect(days).toHaveLength(1)
    expect(days[0]?.normalRange.readinessScore).toEqual({ mean: 80, low: 80, high: 80 })
    expect(days[0]?.normalRange.averageHrv).toBeNull()
    expect(days[0]?.normalRange.restingHeartRate).toBeNull()
  })
})
