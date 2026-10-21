import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, weekdayOf, type Weekday } from '../lib/dates.ts'
import type { CorosBaseline } from './baseline.ts'
import {
  generatePlan,
  MAX_WEEKLY_INCREASE,
  MIN_START_MINUTES,
  phasesFor,
  pickHardDays,
  RECOVERY_EVERY,
} from './generate.ts'
import { RACE_DISTANCES, type Goal } from './goal.ts'
import { isHard } from './sessions.ts'

const START = '2026-10-15' // a Thursday

const baseline = (weeklyMinutes: number): CorosBaseline => ({
  weeklyMinutes,
  weeklyKm: weeklyMinutes / 6,
  runsPerWeek: 4,
  longestRunMinutes: 80,
  minutesPerKm: 6,
  weeks: [],
})

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  raceDistance: 'half',
  raceDate: addDays(START, 7 * 12 + 2), // a Saturday
  timeWindows: [1, 3, 5, 6].map((weekday) => ({ weekday, start: '06:00', end: '08:00' })),
  longRunWeekday: 6,
  ...overrides,
})

const windows = (weekdays: number[]) => weekdays.map((weekday) => ({ weekday, start: '06:00', end: '08:00' }))

// Every distance, a spread of race dates, availability patterns, and starting fitness.
const scenarios = RACE_DISTANCES.flatMap((raceDistance) =>
  [3, 5, 9, 16, 30].flatMap((weeks) =>
    [
      { days: [1, 3, 5, 6], long: 6 },
      { days: [0, 1, 2, 3, 4, 5, 6], long: 5 },
      { days: [2, 6], long: 6 },
      { days: [0, 2, 4], long: 0 },
    ].flatMap(({ days, long }) =>
      [0, 150, 500].map((minutes) => ({
        goal: goal({
          raceDistance,
          raceDate: addDays(START, weeks * 7 + 3),
          timeWindows: windows(days),
          longRunWeekday: long,
        }),
        baseline: baseline(minutes),
      })),
    ),
  ),
)

describe('generatePlan', () => {
  it('never puts two hard sessions on consecutive days', () => {
    for (const scenario of scenarios) {
      const { sessions } = generatePlan(scenario.goal, scenario.baseline, START)
      for (let i = 1; i < sessions.length; i++) {
        const [a, b] = [sessions[i - 1]!, sessions[i]!]
        if (daysBetween(a.day, b.day) === 1) {
          expect(isHard(a.kind) && isHard(b.kind), `${a.day} ${a.kind} then ${b.kind}`).toBe(false)
        }
      }
    }
  })

  it('grows weekly volume by at most 10% over any earlier week', () => {
    for (const scenario of scenarios) {
      const { weeks } = generatePlan(scenario.goal, scenario.baseline, START)
      const start = Math.max(MIN_START_MINUTES, scenario.baseline.weeklyMinutes)
      expect(weeks[0]!.targetMinutes).toBeLessThanOrEqual(start)
      let biggest = weeks[0]!.targetMinutes
      for (const week of weeks.slice(1)) {
        expect(week.targetMinutes).toBeLessThanOrEqual(Math.ceil(biggest * (1 + MAX_WEEKLY_INCREASE)))
        biggest = Math.max(biggest, week.targetMinutes)
      }
    }
  })

  it('makes every 4th week a lighter recovery week before the peak', () => {
    const { weeks } = generatePlan(goal({ raceDate: addDays(START, 7 * 20) }), baseline(180), START)
    const recoveries = weeks.filter((w) => w.recovery)
    expect(recoveries.map((w) => w.index)).toEqual(
      weeks.filter((w) => w.index % RECOVERY_EVERY === RECOVERY_EVERY - 1 && w.phase !== 'peak' && w.phase !== 'taper').map((w) => w.index),
    )
    for (const week of recoveries) {
      expect(week.targetMinutes).toBeLessThan(weeks[week.index - 1]!.targetMinutes)
    }
  })

  it('schedules only training days, from the start day to the race, with one race', () => {
    for (const scenario of scenarios) {
      const { sessions } = generatePlan(scenario.goal, scenario.baseline, START)
      const trainingDays = scenario.goal.timeWindows.map((w) => w.weekday)
      expect(sessions.filter((s) => s.kind === 'race').map((s) => s.day)).toEqual([scenario.goal.raceDate])
      for (const session of sessions) {
        expect(session.day >= START && session.day <= scenario.goal.raceDate).toBe(true)
        if (session.kind !== 'race') expect(trainingDays).toContain(weekdayOf(session.day))
      }
      expect(new Set(sessions.map((s) => s.day)).size).toBe(sessions.length)
    }
  })

  it('counts phases back from the race and tapers into it', () => {
    const { weeks, sessions } = generatePlan(goal(), baseline(200), START)
    expect(weeks.map((w) => w.phase)).toEqual(phasesFor(weeks.length, 'half'))
    expect(weeks.at(-1)!.phase).toBe('taper')
    expect(weeks.at(-1)!.targetMinutes).toBeLessThan(weeks.at(-3)!.targetMinutes)
    const raceWeek = sessions.filter((s) => s.weekIndex === weeks.length - 1 && s.kind !== 'race')
    expect(raceWeek.every((s) => s.kind === 'easy')).toBe(true)
  })

  it('puts the long run on the preferred day', () => {
    const { sessions, weeks } = generatePlan(goal(), baseline(200), START)
    const longRuns = sessions.filter((s) => s.kind === 'long')
    expect(longRuns.length).toBe(weeks.length - 1)
    expect(longRuns.every((s) => weekdayOf(s.day) === 6)).toBe(true)
  })

  it('starts from the COROS baseline and adds hard sessions as the plan builds', () => {
    const { weeks, sessions } = generatePlan(goal(), baseline(200), START)
    expect(weeks[0]!.targetMinutes).toBe(200)
    const hardIn = (phase: string) =>
      sessions.filter((s) => s.phase === phase && (s.kind === 'tempo' || s.kind === 'intervals'))
    expect(hardIn('base').every((s) => s.kind === 'tempo')).toBe(true)
    expect(hardIn('build').some((s) => s.kind === 'intervals')).toBe(true)
  })

  it('is deterministic', () => {
    expect(generatePlan(goal(), baseline(200), START)).toEqual(generatePlan(goal(), baseline(200), START))
  })
})

describe('phasesFor', () => {
  it('always ends with a taper and keeps base before build before peak', () => {
    expect(phasesFor(12, 'half')).toEqual([
      'base', 'base', 'base', 'base', 'build', 'build', 'build', 'build', 'peak', 'peak', 'taper', 'taper',
    ])
    expect(phasesFor(1, 'marathon')).toEqual(['taper'])
    expect(phasesFor(3, '5k')).toEqual(['base', 'build', 'taper'])
  })
})

describe('pickHardDays', () => {
  it('spreads hard days away from the long run and each other, across the week boundary too', () => {
    const all = [0, 1, 2, 3, 4, 5, 6] as Weekday[]
    expect(pickHardDays(all, 6, 2)).toEqual([2, 4])
    expect(pickHardDays([0, 1, 5, 6] as Weekday[], 5, 2)).toEqual([1])
    // Sunday long run: Monday is next to it across the boundary.
    expect(pickHardDays([0, 2, 6] as Weekday[], 6, 1)).toEqual([2])
  })
})
