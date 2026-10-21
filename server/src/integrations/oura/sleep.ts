import { localDateOf, type IsoDate } from '../../lib/dates.ts'

type SleepPeriodLike = {
  type?: string | null
  bedtime_end: string
  total_sleep_duration?: number | null
}

/**
 * Picks each night's main sleep, keyed by the day the user woke up.
 *
 * Oura returns several sleep periods per day (long sleep, naps, rest). Only `long_sleep` stands
 * for the night; using anything else lets a nap's HRV become the night's value. A night belongs
 * to the day it ended, not the day it started. With two long sleeps ending the same day (split
 * sleep), the longer one wins.
 */
export function nightlySleepByWakeDay<T extends SleepPeriodLike>(
  periods: T[],
  timeZone: string,
): Map<IsoDate, T> {
  const nights = new Map<IsoDate, T>()
  for (const period of periods) {
    if (period.type !== 'long_sleep') continue
    const wakeDay = localDateOf(period.bedtime_end, timeZone)
    const current = nights.get(wakeDay)
    if (!current || (period.total_sleep_duration ?? 0) > (current.total_sleep_duration ?? 0)) {
      nights.set(wakeDay, period)
    }
  }
  return nights
}
