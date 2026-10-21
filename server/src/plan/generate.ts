import { addDays, daysBetween, startOfWeek, type IsoDate, type Weekday } from '../lib/dates.ts'
import type { CorosBaseline } from './baseline.ts'
import { RACE_KM, type Goal, type RaceDistance } from './goal.ts'
import { isHard, roundMinutes, type Phase, type SessionKind } from './sessions.ts'

/** Most a week may grow over the biggest week before it (README, "conservative progression"). */
export const MAX_WEEKLY_INCREASE = 0.1
/** How much a building week grows, leaving headroom under the cap for rounding. */
const BUILD_STEP = 1.08
/** Every 4th week is a recovery week at 70% of the week before it. */
export const RECOVERY_EVERY = 4
const RECOVERY_FACTOR = 0.7
/** Weekly minutes a plan starts from when COROS shows less (or nothing). */
export const MIN_START_MINUTES = 90
const DEFAULT_MINUTES_PER_KM = 6.5

type DistanceSpec = {
  /** Weekly minutes the build aims for; a plan never grows past it (but keeps a bigger baseline). */
  peakMinutes: number
  /** Longest a long run gets. */
  longRunCap: number
  /** Weekly volume of the taper weeks as a share of the peak, the race week last. */
  taper: number[]
}

const SPECS: Record<RaceDistance, DistanceSpec> = {
  '5k': { peakMinutes: 210, longRunCap: 75, taper: [0.6] },
  '10k': { peakMinutes: 250, longRunCap: 95, taper: [0.6] },
  half: { peakMinutes: 320, longRunCap: 130, taper: [0.75, 0.5] },
  marathon: { peakMinutes: 440, longRunCap: 180, taper: [0.75, 0.5] },
}

export type PlanWeek = {
  index: number
  /** The Monday the week starts on. */
  start: IsoDate
  phase: Phase
  recovery: boolean
  /** Weekly running minutes the week aims for, race excluded. */
  targetMinutes: number
}

export type SessionDraft = {
  day: IsoDate
  weekIndex: number
  phase: Phase
  kind: SessionKind
  minutes: number
}

export type GeneratedPlan = { weeks: PlanWeek[]; sessions: SessionDraft[] }

/** Phases counted back from the race: taper, then peak, then build and base sharing the rest. */
export function phasesFor(weekCount: number, distance: RaceDistance): Phase[] {
  const taper = Math.max(1, Math.min(SPECS[distance].taper.length, weekCount - 1))
  const remaining = weekCount - taper
  const peak = remaining >= 6 ? 2 : remaining >= 3 ? 1 : 0
  const base = Math.floor((remaining - peak) / 2)
  const build = remaining - peak - base
  return [
    ...Array<Phase>(base).fill('base'),
    ...Array<Phase>(build).fill('build'),
    ...Array<Phase>(peak).fill('peak'),
    ...Array<Phase>(taper).fill('taper'),
  ]
}

/** Each week's target minutes: steady growth to the peak, recovery weeks, then the taper. */
export function weekTargets(phases: Phase[], distance: RaceDistance, baselineMinutes: number) {
  const spec = SPECS[distance]
  let level = Math.max(MIN_START_MINUTES, baselineMinutes)
  const peak = Math.max(spec.peakMinutes, level)
  const taperFactors = spec.taper.slice(-phases.filter((p) => p === 'taper').length)
  let taperIndex = 0

  return phases.map((phase, index) => {
    if (phase === 'taper') {
      const target = Math.round(level * (taperFactors[taperIndex++] ?? 0.5))
      return { phase, recovery: false, targetMinutes: target }
    }
    const recovery = index % RECOVERY_EVERY === RECOVERY_EVERY - 1 && phase !== 'peak'
    if (recovery) return { phase, recovery, targetMinutes: Math.round(level * RECOVERY_FACTOR) }
    if (index > 0) level = Math.min(peak, level * BUILD_STEP)
    return { phase, recovery, targetMinutes: Math.round(level) }
  })
}

const adjacent = (a: Weekday, b: Weekday) => (a - b + 7) % 7 === 1 || (b - a + 7) % 7 === 1
const circularDistance = (a: Weekday, b: Weekday) => Math.min((a - b + 7) % 7, (b - a + 7) % 7)

/**
 * Weekdays for `count` hard sessions among the training days, as far from the long run and each
 * other as they fit. The week is treated as a circle, so a hard Sunday never meets a hard Monday.
 */
export function pickHardDays(trainingDays: Weekday[], longRunDay: Weekday, count: number): Weekday[] {
  const candidates = trainingDays
    .filter((day) => day !== longRunDay && !adjacent(day, longRunDay))
    .sort((a, b) => circularDistance(b, longRunDay) - circularDistance(a, longRunDay) || a - b)
  const picked: Weekday[] = []
  for (const day of candidates) {
    if (picked.length === count) break
    if (picked.every((other) => !adjacent(other, day))) picked.push(day)
  }
  return picked.sort((a, b) => a - b)
}

const HARD_SESSIONS: Record<Phase, SessionKind[]> = {
  base: ['tempo'],
  build: ['intervals', 'tempo'],
  peak: ['intervals', 'tempo'],
  taper: ['tempo'],
}

/** Share of the week the long run takes, by how many runs share it. */
const longRunShare = (runs: number) => (runs >= 5 ? 0.28 : runs === 4 ? 0.3 : runs === 3 ? 0.35 : 0.45)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function weekSessions(
  week: PlanWeek,
  goal: Goal,
  days: { day: IsoDate; weekday: Weekday }[],
): SessionDraft[] {
  const spec = SPECS[goal.raceDistance]
  const session = (day: IsoDate, kind: SessionKind, minutes: number): SessionDraft => ({
    day,
    weekIndex: week.index,
    phase: week.phase,
    kind,
    minutes,
  })
  if (days.length === 0) return []

  const trainingDays = goal.timeWindows.map((w) => w.weekday as Weekday)
  const longRunDay = goal.longRunWeekday as Weekday
  // A week cut short by the plan's start gets its share of the volume, and a long run only if
  // its usual day is still in it.
  const target = (week.targetMinutes * days.length) / trainingDays.length
  const hardCount = week.recovery || days.length <= 2 ? 0 : days.length === 3 ? 1 : HARD_SESSIONS[week.phase].length
  const hardDays = pickHardDays(trainingDays, longRunDay, hardCount)
  const hardKinds = HARD_SESSIONS[week.phase]
  const longDay = days.find((d) => d.weekday === longRunDay)

  const long = longDay
    ? clamp(roundMinutes(week.targetMinutes * longRunShare(trainingDays.length)), 30, spec.longRunCap)
    : 0
  const hard = days.filter((d) => d !== longDay && hardDays.includes(d.weekday))
  const hardMinutes = (kind: SessionKind) =>
    kind === 'intervals'
      ? clamp(roundMinutes(week.targetMinutes * 0.17), 25, 55)
      : clamp(roundMinutes(week.targetMinutes * 0.17), 20, 50)
  const hardSessions = hard.map((d, i) => {
    const kind = hardKinds[i % hardKinds.length]!
    return session(d.day, kind, hardMinutes(kind))
  })
  const easyDays = days.filter((d) => d !== longDay && !hard.includes(d))
  const left = target - long - hardSessions.reduce((sum, s) => sum + s.minutes, 0)
  const easy = clamp(roundMinutes(left / Math.max(1, easyDays.length)), 20, 75)

  return [
    ...(longDay ? [session(longDay.day, 'long', long)] : []),
    ...hardSessions,
    ...easyDays.map((d) => session(d.day, 'easy', easy)),
  ].sort((a, b) => a.day.localeCompare(b.day))
}

/** The race week: easy running to stay loose, then the race. Nothing after it. */
function raceWeekSessions(
  week: PlanWeek,
  goal: Goal,
  days: { day: IsoDate; weekday: Weekday }[],
  minutesPerKm: number,
): SessionDraft[] {
  const before = days.filter((d) => d.day < goal.raceDate)
  const easy = clamp(roundMinutes(week.targetMinutes / Math.max(1, before.length)), 20, 40)
  const raceMinutes = roundMinutes(RACE_KM[goal.raceDistance] * minutesPerKm)
  const base = { weekIndex: week.index, phase: week.phase }
  return [
    ...before.map((d) => ({ ...base, day: d.day, kind: 'easy' as const, minutes: easy })),
    { ...base, day: goal.raceDate, kind: 'race' as const, minutes: raceMinutes },
  ]
}

/**
 * Turns the second of two hard days in a row into an easy run (the first, if the second is the
 * race). The weekly pattern already avoids this; weeks cut short at the plan's start or a race
 * early in the week can still line two up.
 */
function separateHardDays(sessions: SessionDraft[]): SessionDraft[] {
  const result = sessions.map((s) => ({ ...s }))
  for (let i = 1; i < result.length; i++) {
    const previous = result[i - 1]!
    const current = result[i]!
    if (!isHard(previous.kind) || !isHard(current.kind) || daysBetween(previous.day, current.day) !== 1) {
      continue
    }
    const softened = current.kind === 'race' ? previous : current
    softened.kind = 'easy'
    softened.minutes = Math.min(softened.minutes, 45)
  }
  return result
}

/**
 * A rules-based plan from `startDay` to the race (README, "Plan generation"). Pure: the same goal,
 * baseline, and start day always give the same plan. Days aren't checked against the calendar
 * here; schedule.ts places sessions in free time.
 */
export function generatePlan(goal: Goal, baseline: CorosBaseline | null, startDay: IsoDate): GeneratedPlan {
  const firstMonday = startOfWeek(startDay)
  const weekCount = Math.floor(daysBetween(firstMonday, goal.raceDate) / 7) + 1
  const phases = phasesFor(weekCount, goal.raceDistance)
  const targets = weekTargets(phases, goal.raceDistance, baseline?.weeklyMinutes ?? 0)
  const minutesPerKm = baseline?.minutesPerKm ?? DEFAULT_MINUTES_PER_KM

  const weeks: PlanWeek[] = targets.map((target, index) => ({
    index,
    start: addDays(firstMonday, 7 * index),
    ...target,
  }))
  const weekdays = goal.timeWindows.map((w) => w.weekday as Weekday).sort((a, b) => a - b)

  const sessions = weeks.flatMap((week) => {
    const days = weekdays
      .map((weekday) => ({ day: addDays(week.start, weekday), weekday }))
      .filter(({ day }) => day >= startDay && day <= goal.raceDate)
    const isRaceWeek = week.index === weeks.length - 1
    return isRaceWeek
      ? raceWeekSessions(week, goal, days, minutesPerKm)
      : weekSessions(week, goal, days.filter(({ day }) => day < goal.raceDate))
  })
  return { weeks, sessions: separateHardDays(sessions) }
}
