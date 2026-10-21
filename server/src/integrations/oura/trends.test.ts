import { describe, expect, it } from 'vitest'
import { buildTrends, secondsFromMidnight } from './trends.ts'

const tz = 'America/Los_Angeles'
const record = (collection: string, day: string, data: Record<string, unknown>) => ({
  collection,
  day,
  data,
})

describe('secondsFromMidnight', () => {
  it('reads the local time a timestamp carries, negative for the evening before', () => {
    expect(secondsFromMidnight('2026-03-02T06:50:00-08:00', '2026-03-02')).toBe(6 * 3600 + 50 * 60)
    expect(secondsFromMidnight('2026-03-01T23:10:00-08:00', '2026-03-02')).toBe(-50 * 60)
    expect(secondsFromMidnight('not a time', '2026-03-02')).toBeNull()
  })
})

describe('buildTrends', () => {
  it('lays every number and enumeration out by day, nested fields joined by dots', () => {
    const trends = buildTrends(
      [
        record('daily_readiness', '2026-03-02', {
          id: 'r1',
          day: '2026-03-02',
          timestamp: '2026-03-02T00:00:00-08:00',
          score: 81,
          temperature_deviation: -0.2,
          contributors: { hrv_balance: 70, resting_heart_rate: null },
        }),
        record('daily_stress', '2026-03-01', { id: 's1', day: '2026-03-01', day_summary: 'restored' }),
        record('daily_activity', '2026-03-01', { id: 'a1', steps: 9000, class_5_min: '0012333' }),
      ],
      [],
      '2026-03-01',
      '2026-03-02',
      tz,
    )
    expect(trends.days).toEqual(['2026-03-01', '2026-03-02'])
    expect(trends.series['daily_readiness.score']).toEqual([null, 81])
    expect(trends.series['daily_readiness.temperature_deviation']).toEqual([null, -0.2])
    expect(trends.series['daily_readiness.contributors.hrv_balance']).toEqual([null, 70])
    expect(trends.series['daily_activity.steps']).toEqual([9000, null])
    expect(trends.labels['daily_stress.day_summary']).toEqual(['restored', null])
    // Identifiers, timestamps, nulls, and per-interval encodings aren't values to chart.
    expect(Object.keys(trends.series)).not.toContain('daily_readiness.contributors.resting_heart_rate')
    expect(Object.keys(trends.labels)).toEqual(['daily_stress.day_summary'])
  })

  it("charts the night's main sleep on the day the user woke up, with bedtime and wake time", () => {
    const night = {
      id: 'n1',
      day: '2026-03-02',
      type: 'long_sleep',
      bedtime_start: '2026-03-01T23:10:00-08:00',
      bedtime_end: '2026-03-02T06:50:00-08:00',
      total_sleep_duration: 26000,
      average_hrv: 48,
      readiness: { score: 81 },
    }
    const nap = {
      ...night,
      id: 'n2',
      type: 'late_nap',
      bedtime_start: '2026-03-02T14:00:00-08:00',
      bedtime_end: '2026-03-02T14:40:00-08:00',
      average_hrv: 75,
    }
    const trends = buildTrends(
      [record('sleep', '2026-03-02', night), record('sleep', '2026-03-02', nap)],
      [],
      '2026-03-02',
      '2026-03-02',
      tz,
    )
    expect(trends.series['sleep.average_hrv']).toEqual([48])
    expect(trends.series['sleep.bedtime_start_offset']).toEqual([-50 * 60])
    expect(trends.series['sleep.bedtime_end_offset']).toEqual([6 * 3600 + 50 * 60])
    expect(trends.series['sleep.readiness.score']).toBeUndefined()
  })

  it('adds heart rate statistics per source and lists workouts and tags', () => {
    const workout = { id: 'w1', day: '2026-03-02', activity: 'running' }
    const trends = buildTrends(
      [record('workout', '2026-03-02', workout), record('enhanced_tag', '2026-03-02', { id: 't1' })],
      [{ day: '2026-03-02', source: 'awake', min: 55, avg: 71.5, max: 120 }],
      '2026-03-01',
      '2026-03-02',
      tz,
    )
    expect(trends.series['heartrate.awake.avg']).toEqual([null, 71.5])
    expect(trends.series['heartrate.awake.max']).toEqual([null, 120])
    expect(trends.lists.workout).toEqual([workout])
    expect(trends.lists.enhanced_tag).toHaveLength(1)
  })
})
