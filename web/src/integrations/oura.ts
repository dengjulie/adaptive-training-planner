import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'

export type OuraMetric = 'readinessScore' | 'averageHrv' | 'restingHeartRate'

/** The mean of the previous 30 days, give or take one standard deviation (server: baseline.ts). */
export type NormalRange = { mean: number; low: number; high: number }

export type OuraDay = Record<OuraMetric, number | null> & {
  /** Calendar date (YYYY-MM-DD) the user woke up on. */
  day: string
  /** Null until the 30 days before hold two weeks of values. */
  normalRange: Record<OuraMetric, NormalRange | null>
}

export const OURA_METRICS: OuraMetric[] = ['readinessScore', 'averageHrv', 'restingHeartRate']

export const METRIC_INFO: Record<
  OuraMetric,
  { label: string; shortLabel: string; unit: string; worseWhen: 'low' | 'high' }
> = {
  readinessScore: { label: 'Readiness', shortLabel: 'Readiness', unit: '', worseWhen: 'low' },
  averageHrv: { label: 'HRV', shortLabel: 'HRV', unit: 'ms', worseWhen: 'low' },
  restingHeartRate: {
    label: 'Resting heart rate',
    shortLabel: 'Resting HR',
    unit: 'bpm',
    worseWhen: 'high',
  },
}

/**
 * Every day the server keeps (the last 60, oldest first, ending today in the user's timezone),
 * including days without data.
 */
export function useOuraDays({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['oura', 'daily'],
    queryFn: async () => (await api<{ days: OuraDay[] }>('/api/oura/daily')).days,
    enabled,
  })
}

export type OuraSyncResult = { days: number; missing: string[]; failed: string[] }

export function useOuraSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<OuraSyncResult>('/api/oura/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oura'] }),
  })
}

/** An Oura API document as Oura sent it (see ouraDocuments.ts for the shapes). */
export type OuraDocument = Record<string, unknown>

export type ListedCollection = 'workout' | 'session' | 'enhanced_tag' | 'tag' | 'rest_mode_period'

/** Everything stored, day by day (server: integrations/oura/trends.ts). */
export type OuraTrends = {
  /** The retention window, oldest first, ending today in the user's timezone. */
  days: string[]
  /** Numbers by day keyed `collection.field`, e.g. `daily_readiness.contributors.hrv_balance`. */
  series: Record<string, (number | null)[]>
  /** Oura's enumerated values by day, e.g. `daily_stress.day_summary`. */
  labels: Record<string, (string | null)[]>
  /** Workouts, sessions, tags, and rest mode periods, oldest first. */
  lists: Record<ListedCollection, OuraDocument[]>
}

export function useOuraTrends({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['oura', 'trends'],
    queryFn: () => api<OuraTrends>('/api/oura/trends'),
    enabled,
  })
}

/** Everything stored for one day, time series included, by collection. */
export type OuraDayRecords = { day: string; records: Partial<Record<string, OuraDocument[]>> }

export function useOuraDay(day: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['oura', 'day', day],
    queryFn: () => api<OuraDayRecords>(`/api/oura/days/${encodeURIComponent(day)}`),
    enabled,
  })
}

export type OuraProfile = {
  personalInfo: OuraDocument | null
  rings: OuraDocument[]
  /** The latest ring battery sample. */
  battery: OuraDocument | null
  /** Collections the user didn't grant the scope for, as of the last full sync. */
  missingCollections: string[]
  /** When the year of history finished syncing; null while it's still coming in. */
  backfilledAt: string | null
}

export function useOuraProfile({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['oura', 'profile'],
    queryFn: () => api<OuraProfile>('/api/oura/profile'),
    enabled,
  })
}

export type RangePosition = 'low' | 'normal' | 'high'

export function positionIn(range: NormalRange, value: number): RangePosition {
  if (value < range.low) return 'low'
  if (value > range.high) return 'high'
  return 'normal'
}

/** Outside the normal range on the side that counts against recovery. */
export function isWorse(metric: OuraMetric, value: number | null, range: NormalRange | null) {
  if (value === null || range === null) return false
  return positionIn(range, value) === METRIC_INFO[metric].worseWhen
}

export const hasAnyValue = (days: OuraDay[]) =>
  days.some((day) => OURA_METRICS.some((metric) => day[metric] !== null))

/** Index of the most recent day with a value for `metric`, or -1. */
export const latestIndex = (days: OuraDay[], metric: OuraMetric) =>
  days.findLastIndex((day) => day[metric] !== null)

export const formatNumber = (value: number | null) => (value === null ? '–' : `${Math.round(value)}`)

const withUnit = (metric: OuraMetric, text: string) => {
  const { unit } = METRIC_INFO[metric]
  return unit ? `${text} ${unit}` : text
}

export const formatValue = (metric: OuraMetric, value: number | null) =>
  value === null ? '–' : withUnit(metric, formatNumber(value))

export const formatRange = (metric: OuraMetric, range: NormalRange) =>
  withUnit(metric, `${Math.round(range.low)}–${Math.round(range.high)}`)

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC', // `day` is a calendar date, not an instant
})

const longDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "Friday, October 9, 2026" for a calendar date. */
export const formatLongDay = (day: string) => longDayFormat.format(new Date(day))

/** "Thu, Oct 8" for a calendar date. */
export const formatShortDay = (day: string) => dayFormat.format(new Date(day))

/** "Today", "Yesterday", or the date. `days` ends today, so position decides. */
export function describeDay(days: string[], index: number) {
  const fromEnd = days.length - 1 - index
  if (fromEnd === 0) return 'Today'
  if (fromEnd === 1) return 'Yesterday'
  const day = days[index]
  return day ? formatShortDay(day) : ''
}

export const dayLabel = (days: OuraDay[], index: number) =>
  describeDay(
    days.map((day) => day.day),
    index,
  )
