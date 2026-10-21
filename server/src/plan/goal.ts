import { z } from 'zod'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.ts'

export const RACE_DISTANCES = ['5k', '10k', 'half', 'marathon'] as const
export type RaceDistance = (typeof RACE_DISTANCES)[number]

export const RACE_KM: Record<RaceDistance, number> = {
  '5k': 5,
  '10k': 10,
  half: 21.0975,
  marathon: 42.195,
}

/** Plans need room for at least a short build and taper, and stop being useful past a year. */
export const MIN_WEEKS_TO_RACE = 3
export const MAX_WEEKS_TO_RACE = 52

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time like 06:30')
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** When the user can train on one weekday (0 = Monday), in their own timezone. */
export const TimeWindowSchema = z
  .object({ weekday: z.number().int().min(0).max(6), start: clock, end: clock })
  .refine((window) => minutesOf(window.end) - minutesOf(window.start) >= 20, {
    message: 'A training window needs at least 20 minutes',
  })
export type TimeWindow = z.infer<typeof TimeWindowSchema>

/**
 * A race goal as the form, the API, and the AI intake all describe it. The AI's draft is parsed
 * with this same schema before the user ever sees it.
 */
export const GoalSchema = z
  .object({
    raceDistance: z.enum(RACE_DISTANCES),
    raceDate: z.iso.date(),
    timeWindows: z.array(TimeWindowSchema).min(2, 'Pick at least two days a week').max(7),
    longRunWeekday: z.number().int().min(0).max(6),
  })
  .refine((goal) => new Set(goal.timeWindows.map((w) => w.weekday)).size === goal.timeWindows.length, {
    message: 'Each weekday can only have one window',
    path: ['timeWindows'],
  })
  .refine((goal) => goal.timeWindows.some((w) => w.weekday === goal.longRunWeekday), {
    message: 'The long run has to be on one of your training days',
    path: ['longRunWeekday'],
  })
export type Goal = z.infer<typeof GoalSchema>

/** The race date problem for a goal starting today, or null when the date works. */
export function raceDateProblem(raceDate: IsoDate, today: IsoDate): string | null {
  const days = daysBetween(today, raceDate)
  if (days < MIN_WEEKS_TO_RACE * 7) {
    return `The race needs to be at least ${MIN_WEEKS_TO_RACE} weeks away (on or after ${addDays(today, MIN_WEEKS_TO_RACE * 7)})`
  }
  if (days > MAX_WEEKS_TO_RACE * 7) return `The race needs to be within ${MAX_WEEKS_TO_RACE} weeks`
  return null
}
