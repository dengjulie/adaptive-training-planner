import { describe, expect, it } from 'vitest'
import { nightlySleepByWakeDay } from './sleep.ts'

const period = (
  type: string,
  bedtime_start: string,
  bedtime_end: string,
  total_sleep_duration: number,
  average_hrv: number,
) => ({ type, bedtime_start, bedtime_end, total_sleep_duration, average_hrv })

describe('nightlySleepByWakeDay', () => {
  const tz = 'America/Los_Angeles'

  it('assigns a night to the day the user woke up', () => {
    const night = period('long_sleep', '2026-03-01T23:10:00-08:00', '2026-03-02T06:50:00-08:00', 26000, 48)
    const nights = nightlySleepByWakeDay([night], tz)
    expect([...nights.keys()]).toEqual(['2026-03-02'])
  })

  it("ignores naps and rest periods so their HRV doesn't replace the night's", () => {
    const night = period('long_sleep', '2026-03-01T23:10:00-08:00', '2026-03-02T06:50:00-08:00', 26000, 48)
    const nap = period('late_nap', '2026-03-02T14:00:00-08:00', '2026-03-02T14:40:00-08:00', 2100, 75)
    const rest = period('rest', '2026-03-02T16:00:00-08:00', '2026-03-02T16:20:00-08:00', 0, 80)
    const nights = nightlySleepByWakeDay([night, nap, rest], tz)
    expect(nights.get('2026-03-02')?.average_hrv).toBe(48)
    expect(nights.size).toBe(1)
  })

  it('keeps the longer long_sleep when two end on the same day', () => {
    const first = period('long_sleep', '2026-03-01T22:00:00-08:00', '2026-03-02T01:30:00-08:00', 11000, 40)
    const second = period('long_sleep', '2026-03-02T02:30:00-08:00', '2026-03-02T08:00:00-08:00', 18000, 52)
    expect(nightlySleepByWakeDay([first, second], tz).get('2026-03-02')?.average_hrv).toBe(52)
  })
})
