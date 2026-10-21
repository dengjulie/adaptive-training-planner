import { addDays, daysBetween, startOfWeek, weekdayOf, zonedInstant, type IsoDate } from '../lib/dates.ts'
import type { TimeWindow } from './goal.ts'
import { isHard, type SessionKind } from './sessions.ts'

export type Interval = { start: Date; end: Date }

export type SchedulableSession = { id: string; day: IsoDate; kind: SessionKind; minutes: number }

/** Where a session ended up: its day (moved if its own had no room) and slot, or no slot. */
export type Placement = { id: string; day: IsoDate; slot: Interval | null }

const MINUTE_MS = 60_000

/** The earliest stretch of `minutes` inside the day's window that misses every busy interval. */
export function findSlot(
  day: IsoDate,
  window: TimeWindow,
  minutes: number,
  busy: Interval[],
  timeZone: string,
): Interval | null {
  const windowStart = zonedInstant(day, window.start, timeZone).getTime()
  const windowEnd = zonedInstant(day, window.end, timeZone).getTime()
  const length = minutes * MINUTE_MS
  let cursor = windowStart
  const overlapping = busy
    .filter((b) => b.end.getTime() > windowStart && b.start.getTime() < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  for (const block of overlapping) {
    if (block.start.getTime() >= cursor + length) break
    cursor = Math.max(cursor, block.end.getTime())
  }
  return cursor + length <= windowEnd ? { start: new Date(cursor), end: new Date(cursor + length) } : null
}

/**
 * Puts sessions into free time (README, "scheduled around the days and times you're actually
 * free"). Each session tries its own day's window first. With no room there it moves to the
 * nearest other training day of the same week that is free, on or after `fromDay`, and (for hard
 * sessions) not next to another hard day. Otherwise it keeps its day without a slot, and the plan
 * page flags it. Races never move. Slots are as long as the base session: an adjustment only ever
 * shortens a session, so it still fits. `others` are sessions that stay put (past days, days
 * beyond the calendar lookup) but still count as taken days and hard days.
 */
export function placeSessions(
  sessions: SchedulableSession[],
  windows: TimeWindow[],
  busy: Interval[],
  timeZone: string,
  fromDay: IsoDate,
  others: Omit<SchedulableSession, 'minutes'>[] = [],
): Placement[] {
  const windowFor = (day: IsoDate) => windows.find((w) => w.weekday === weekdayOf(day))
  const ordered = [...sessions].sort((a, b) => a.day.localeCompare(b.day))
  const dayOf = new Map(ordered.map((s) => [s.id, s.day]))
  const taken: Interval[] = [...busy]
  const placements: Placement[] = []

  const everyone = [...ordered, ...others]
  for (const other of others) dayOf.set(other.id, other.day)
  const occupied = (day: IsoDate, except: string) =>
    everyone.some((s) => s.id !== except && dayOf.get(s.id) === day)
  const nextToHard = (day: IsoDate, except: string) =>
    everyone.some(
      (s) => s.id !== except && isHard(s.kind) && Math.abs(daysBetween(dayOf.get(s.id)!, day)) === 1,
    )
  const tryDay = (session: SchedulableSession, day: IsoDate) => {
    const window = windowFor(day)
    return window ? findSlot(day, window, session.minutes, taken, timeZone) : null
  }

  for (const session of ordered) {
    let day = session.day
    let slot = tryDay(session, day)
    if (!slot && session.kind !== 'race') {
      const weekStart = startOfWeek(session.day)
      const alternatives = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        .filter((candidate) => candidate !== session.day && candidate >= fromDay && windowFor(candidate))
        .filter((candidate) => !occupied(candidate, session.id))
        .filter((candidate) => !isHard(session.kind) || !nextToHard(candidate, session.id))
        .sort(
          (a, b) =>
            Math.abs(daysBetween(session.day, a)) - Math.abs(daysBetween(session.day, b)) ||
            a.localeCompare(b),
        )
      for (const candidate of alternatives) {
        const candidateSlot = tryDay(session, candidate)
        if (candidateSlot) {
          day = candidate
          slot = candidateSlot
          break
        }
      }
    }
    dayOf.set(session.id, day)
    if (slot) taken.push(slot)
    placements.push({ id: session.id, day, slot })
  }
  return placements
}
