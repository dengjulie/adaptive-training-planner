import { formatDuration } from '../format.ts'
import type { Phase, RaceDistance, SessionKind } from './api.ts'

/** 0 = Monday, as the server counts. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const KIND_LABELS: Record<SessionKind, string> = {
  easy: 'Easy run',
  long: 'Long run',
  tempo: 'Tempo run',
  intervals: 'Intervals',
  race: 'Race',
  rest: 'Rest',
}

export const RACE_LABELS: Record<RaceDistance, string> = {
  '5k': '5K',
  '10k': '10K',
  half: 'Half marathon',
  marathon: 'Marathon',
}

export const PHASE_LABELS: Record<Phase, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
}

/** Hard sessions, styled apart from easy ones (server: sessions.ts, isHard). */
export const isHard = (kind: SessionKind) =>
  kind === 'tempo' || kind === 'intervals' || kind === 'long' || kind === 'race'

/** "Tempo run · 40 min", "Rest". */
export function sessionLabel(kind: SessionKind, minutes: number) {
  return kind === 'rest' || kind === 'race' ? KIND_LABELS[kind] : `${KIND_LABELS[kind]} · ${minutes} min`
}

/** Plan minutes as "3h 40m". */
export const formatMinutes = (minutes: number) => formatDuration(minutes * 60)

export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const longDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

/** A calendar date as "Oct 15". */
export const formatDate = (day: string) => dateFormat.format(new Date(`${day}T00:00:00Z`))
/** A calendar date as "Thursday, October 15". */
export const formatLongDate = (day: string) => longDateFormat.format(new Date(`${day}T00:00:00Z`))

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** A slot's start in the browser's timezone, the user's own: "6:30 AM". */
export const formatTime = (instant: string) => clockFormat.format(new Date(instant))
