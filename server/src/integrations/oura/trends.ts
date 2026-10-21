import type { OuraDocument } from '../../db/schema.ts'
import { addDays, type IsoDate } from '../../lib/dates.ts'
import type { HeartRateStat } from './records.ts'
import { nightlySleepByWakeDay } from './sleep.ts'

/** Collections with at most one document a day, charted day by day. */
const DAILY_COLLECTIONS = new Set([
  'daily_readiness',
  'daily_sleep',
  'daily_activity',
  'daily_spo2',
  'daily_stress',
  'daily_resilience',
  'daily_cardiovascular_age',
  'vO2_max',
  'sleep_time',
])

/** Collections with any number of documents a day, listed rather than charted. */
const LISTED_COLLECTIONS = ['workout', 'session', 'enhanced_tag', 'tag', 'rest_mode_period'] as const
type ListedCollection = (typeof LISTED_COLLECTIONS)[number]

export type OuraTrends = {
  /** Every day of the window, oldest first. */
  days: IsoDate[]
  /**
   * Numbers by day, aligned with `days` (null where there's none), keyed by collection and field
   * with nested fields joined by dots, e.g. `daily_readiness.contributors.hrv_balance`. Every
   * numeric field Oura sends ends up here. `sleep.*` is the night's main sleep, by wake-up day.
   */
  series: Record<string, (number | null)[]>
  /** Oura's enumerated values by day, e.g. `daily_stress.day_summary`, keyed the same way. */
  labels: Record<string, (string | null)[]>
  /** Documents of collections with several a day, oldest first, without their time series. */
  lists: Record<ListedCollection, OuraDocument[]>
}

type Summary = { collection: string; day: IsoDate | null; data: OuraDocument }

/** Fields that identify or date a document rather than measure something. */
const NOT_MEASURES = new Set(['id', 'day', 'timestamp', 'ring_id', 'period'])

/** An Oura enumeration (`restored`, `long_sleep`, `v2`), as opposed to timestamps or free text. */
const ENUMERATION = /^(?=.*[a-z])[a-z0-9_]+$/

function flatten(
  document: Record<string, unknown>,
  prefix: string,
  visit: (key: string, value: number | string) => void,
) {
  for (const [field, value] of Object.entries(document)) {
    if (NOT_MEASURES.has(field)) continue
    const key = `${prefix}.${field}`
    if (typeof value === 'number' || (typeof value === 'string' && ENUMERATION.test(value))) {
      visit(key, value)
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, key, visit)
    }
  }
}

/**
 * Seconds from the midnight that starts `day` to `timestamp`, by the local time the timestamp
 * carries: negative for the evening before. Oura's bedtime recommendations use the same scale.
 */
export function secondsFromMidnight(timestamp: unknown, day: IsoDate): number | null {
  if (typeof timestamp !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) return null
  const [, date, hours, minutes, seconds] = match
  const daysApart = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
  return daysApart * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

type SleepDocument = OuraDocument & {
  type?: string | null
  bedtime_start: string
  bedtime_end: string
  total_sleep_duration?: number | null
}

const isSleepDocument = (document: OuraDocument): document is SleepDocument =>
  typeof document.bedtime_start === 'string' &&
  typeof document.bedtime_end === 'string' &&
  (document.type == null || typeof document.type === 'string') &&
  (document.total_sleep_duration == null || typeof document.total_sleep_duration === 'number')

const isListed = (collection: string): collection is ListedCollection =>
  (LISTED_COLLECTIONS as readonly string[]).includes(collection)

/** Lays stored records and heart rate statistics out day by day for charting. */
export function buildTrends(
  summaries: Summary[],
  heartRate: HeartRateStat[],
  start: IsoDate,
  end: IsoDate,
  timeZone: string,
): OuraTrends {
  const days: IsoDate[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day)
  const indexOf = new Map(days.map((day, index) => [day, index]))
  const series: OuraTrends['series'] = {}
  const labels: OuraTrends['labels'] = {}
  const set = (day: IsoDate, key: string, value: number | string) => {
    const index = indexOf.get(day)
    if (index === undefined) return
    if (typeof value === 'number') {
      ;(series[key] ??= Array<number | null>(days.length).fill(null))[index] = value
    } else {
      ;(labels[key] ??= Array<string | null>(days.length).fill(null))[index] = value
    }
  }

  const lists: OuraTrends['lists'] = {
    workout: [],
    session: [],
    enhanced_tag: [],
    tag: [],
    rest_mode_period: [],
  }
  const sleepPeriods: SleepDocument[] = []
  for (const { collection, day, data } of summaries) {
    if (day === null) continue
    if (DAILY_COLLECTIONS.has(collection)) flatten(data, collection, (key, value) => set(day, key, value))
    else if (collection === 'sleep' && isSleepDocument(data)) sleepPeriods.push(data)
    else if (isListed(collection)) lists[collection].push(data)
  }

  for (const [day, night] of nightlySleepByWakeDay(sleepPeriods, timeZone)) {
    // The readiness a sleep carries repeats daily_readiness, which is charted already.
    const measures: Record<string, unknown> = { ...night }
    delete measures.readiness
    flatten(measures, 'sleep', (key, value) => set(day, key, value))
    const bedtime = secondsFromMidnight(night.bedtime_start, day)
    const wakeTime = secondsFromMidnight(night.bedtime_end, day)
    if (bedtime !== null) set(day, 'sleep.bedtime_start_offset', bedtime)
    if (wakeTime !== null) set(day, 'sleep.bedtime_end_offset', wakeTime)
  }

  for (const { day, source, min, avg, max } of heartRate) {
    set(day, `heartrate.${source}.min`, min)
    set(day, `heartrate.${source}.avg`, avg)
    set(day, `heartrate.${source}.max`, max)
  }
  return { days, series, labels, lists }
}
