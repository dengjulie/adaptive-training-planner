import { describe, expect, it } from 'vitest'
import { syntheticRuns } from '../../tests/fixtures/coros/synthetic.ts'
import { baselineStart, corosBaseline } from './baseline.ts'

const TODAY = '2026-10-15' // Thursday; the baseline is the 8 full weeks before Monday 10-12

describe('corosBaseline', () => {
  const activities = syntheticRuns({
    start: '2026-07-01',
    end: TODAY,
    pattern: [
      { weekday: 1, minutes: 40, minutesPerKm: 6 },
      { weekday: 3, minutes: 40, minutesPerKm: 5 },
      { weekday: 6, minutes: 80, minutesPerKm: 6 },
    ],
    strengthWeekday: 2,
  })

  it('averages running volume over the last 4 full weeks', () => {
    const baseline = corosBaseline(activities, TODAY)
    expect(baseline.weeks).toHaveLength(8)
    expect(baseline.weeks[0]!.weekStart).toBe(baselineStart(TODAY))
    expect(baseline.weeks.at(-1)!.weekStart).toBe('2026-10-05')
    expect(baseline.runsPerWeek).toBe(3)
    expect(baseline.weeklyMinutes).toBeGreaterThan(150)
    expect(baseline.weeklyMinutes).toBeLessThan(170)
    expect(baseline.longestRunMinutes).toBeGreaterThanOrEqual(80)
    expect(baseline.minutesPerKm).toBeGreaterThan(5)
    expect(baseline.minutesPerKm).toBeLessThan(6)
  })

  it('ignores strength sessions and the current week', () => {
    const baseline = corosBaseline(activities, TODAY)
    expect(baseline.weeks.every((w) => w.runs === 3)).toBe(true)
  })

  it('is all zeros without history', () => {
    expect(corosBaseline([], TODAY)).toMatchObject({ weeklyMinutes: 0, runsPerWeek: 0, minutesPerKm: null })
  })
})
