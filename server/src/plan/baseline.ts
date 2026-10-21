import type { CorosActivity } from '../integrations/coros/activities.ts'
import { addDays, startOfWeek, type IsoDate } from '../lib/dates.ts'

/**
 * COROS sport types that count as running: Run, Indoor Run, Trail Run, Track Run. Strength
 * (402) and cycling (200) appear in querySportRecords output too, and don't.
 */
export const RUN_SPORT_TYPES: ReadonlySet<number> = new Set([100, 101, 102, 103])

export const isRun = (activity: CorosActivity) =>
  activity.sportType !== null && RUN_SPORT_TYPES.has(activity.sportType)

/** Full weeks of history the baseline looks at (README, "Baseline": 8 to 12 weeks). */
export const BASELINE_WEEKS = 8
/** The most recent weeks, which stand for current fitness. */
const RECENT_WEEKS = 4

export type BaselineWeek = { weekStart: IsoDate; minutes: number; km: number; runs: number }

/**
 * Current running fitness from COROS history. Derived only from COROS, so the AI goal intake may
 * read it: keep Oura values out of this type.
 */
export type CorosBaseline = {
  /** Average weekly running minutes over the last 4 full weeks. */
  weeklyMinutes: number
  weeklyKm: number
  runsPerWeek: number
  /** Longest single run in the last 8 weeks, in minutes. */
  longestRunMinutes: number
  /** Average pace over runs with a distance, or null without any. */
  minutesPerKm: number | null
  /** The last 8 full weeks, oldest first. */
  weeks: BaselineWeek[]
}

/** The first day of activity history `corosBaseline` reads for a plan starting `today`. */
export const baselineStart = (today: IsoDate) => addDays(startOfWeek(today), -7 * BASELINE_WEEKS)

/** Weekly running volume over the full weeks before the week `today` falls in. */
export function corosBaseline(activities: CorosActivity[], today: IsoDate): CorosBaseline {
  const start = baselineStart(today)
  const weeks: BaselineWeek[] = Array.from({ length: BASELINE_WEEKS }, (_, i) => ({
    weekStart: addDays(start, 7 * i),
    minutes: 0,
    km: 0,
    runs: 0,
  }))
  let longest = 0
  let pacedMinutes = 0
  let pacedKm = 0

  for (const activity of activities) {
    if (!isRun(activity) || activity.durationSeconds === null) continue
    const week = weeks.find((w) => activity.date >= w.weekStart && activity.date < addDays(w.weekStart, 7))
    if (!week) continue
    const minutes = activity.durationSeconds / 60
    week.minutes += minutes
    week.km += activity.distanceKm ?? 0
    week.runs += 1
    longest = Math.max(longest, minutes)
    if (activity.distanceKm) {
      pacedMinutes += minutes
      pacedKm += activity.distanceKm
    }
  }

  const recent = weeks.slice(-RECENT_WEEKS)
  const average = (pick: (week: BaselineWeek) => number) =>
    recent.reduce((sum, week) => sum + pick(week), 0) / recent.length
  return {
    weeklyMinutes: Math.round(average((w) => w.minutes)),
    weeklyKm: Math.round(average((w) => w.km) * 10) / 10,
    runsPerWeek: Math.round(average((w) => w.runs) * 10) / 10,
    longestRunMinutes: Math.round(longest),
    minutesPerKm: pacedKm > 0 ? Math.round((pacedMinutes / pacedKm) * 100) / 100 : null,
    weeks: weeks.map((w) => ({ ...w, minutes: Math.round(w.minutes), km: Math.round(w.km * 10) / 10 })),
  }
}
