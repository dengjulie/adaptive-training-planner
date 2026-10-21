import type { GoalInput } from './api.ts'
import { addDays } from './format.ts'

export const defaultWindow = (weekday: number) =>
  weekday >= 5 ? { weekday, start: '08:00', end: '11:00' } : { weekday, start: '06:30', end: '08:00' }

/** Today in the browser's timezone, as YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString('en-CA')

/** A starting point for the form: a half marathon in 12 weeks, four days a week. */
export function defaultGoal(today = localToday()): GoalInput {
  return {
    raceDistance: 'half',
    raceDate: addDays(today, 12 * 7),
    timeWindows: [1, 3, 5, 6].map(defaultWindow),
    longRunWeekday: 6,
  }
}
