import { describe, expect, it } from 'vitest'
import type { TimeWindow } from './goal.ts'
import { findSlot, placeSessions, type Interval, type SchedulableSession } from './schedule.ts'

const TZ = 'America/Los_Angeles'
// 2026-10-12 is a Monday; Los Angeles is UTC-7 then.
const window = (weekday: number, start = '06:00', end = '08:00'): TimeWindow => ({ weekday, start, end })
const at = (iso: string) => new Date(iso)
const busy = (start: string, end: string): Interval => ({ start: at(start), end: at(end) })
const session = (id: string, day: string, kind: SchedulableSession['kind'] = 'easy', minutes = 45) => ({
  id,
  day,
  kind,
  minutes,
})

describe('findSlot', () => {
  it('takes the start of the window when it is free, in the user’s timezone', () => {
    expect(findSlot('2026-10-13', window(1), 45, [], TZ)).toEqual({
      start: at('2026-10-13T13:00:00Z'),
      end: at('2026-10-13T13:45:00Z'),
    })
  })

  it('fits between busy blocks', () => {
    const blocks = [busy('2026-10-13T12:30:00Z', '2026-10-13T13:30:00Z'), busy('2026-10-13T14:30:00Z', '2026-10-13T15:00:00Z')]
    expect(findSlot('2026-10-13', window(1), 45, blocks, TZ)).toEqual({
      start: at('2026-10-13T13:30:00Z'),
      end: at('2026-10-13T14:15:00Z'),
    })
  })

  it('returns null when nothing long enough is free', () => {
    const blocks = [busy('2026-10-13T13:20:00Z', '2026-10-13T14:20:00Z')]
    expect(findSlot('2026-10-13', window(1), 45, blocks, TZ)).toBeNull()
  })
})

describe('placeSessions', () => {
  const windows = [window(1), window(2), window(3), window(5), window(6, '07:00', '11:00')]
  const tuesdayFull = busy('2026-10-13T13:00:00Z', '2026-10-13T15:00:00Z')

  it('keeps sessions on their day when there is room', () => {
    const placed = placeSessions([session('a', '2026-10-13'), session('b', '2026-10-18', 'long', 90)], windows, [], TZ, '2026-10-12')
    expect(placed.map((p) => p.day)).toEqual(['2026-10-13', '2026-10-18'])
    expect(placed[1]!.slot?.start).toEqual(at('2026-10-18T14:00:00Z'))
  })

  it('moves a session to the nearest free training day when its own is booked', () => {
    const placed = placeSessions([session('a', '2026-10-13')], windows, [tuesdayFull], TZ, '2026-10-12')
    expect(placed[0]!.day).toBe('2026-10-14')
  })

  it('does not move a hard session next to another hard day', () => {
    const placed = placeSessions(
      [session('tempo', '2026-10-13', 'tempo'), session('long', '2026-10-15', 'long')],
      windows,
      [tuesdayFull],
      TZ,
      '2026-10-12',
    )
    // Wednesday and Thursday sit next to the long run, so the tempo goes to Saturday.
    expect(placed.find((p) => p.id === 'tempo')!.day).toBe('2026-10-17')
  })

  it('never moves onto days already taken, including sessions it is not placing', () => {
    const placed = placeSessions([session('a', '2026-10-13')], windows, [tuesdayFull], TZ, '2026-10-12', [
      { id: 'other', day: '2026-10-14', kind: 'easy' },
    ])
    expect(placed[0]!.day).toBe('2026-10-15')
  })

  it('does not move into the past', () => {
    const placed = placeSessions([session('a', '2026-10-15')], [window(1), window(3)], [busy('2026-10-15T13:00:00Z', '2026-10-15T15:00:00Z')], TZ, '2026-10-14')
    expect(placed[0]).toEqual({ id: 'a', day: '2026-10-15', slot: null })
  })

  it('keeps races on their day even without a slot', () => {
    const placed = placeSessions([session('race', '2026-10-13', 'race', 150)], windows, [], TZ, '2026-10-12')
    expect(placed[0]).toEqual({ id: 'race', day: '2026-10-13', slot: null })
  })

  it('does not double-book two sessions moved into the same time', () => {
    const placed = placeSessions(
      [session('a', '2026-10-13', 'easy', 60), session('b', '2026-10-14', 'easy', 60)],
      [window(1), window(2)],
      [tuesdayFull],
      TZ,
      '2026-10-12',
    )
    expect(placed.find((p) => p.id === 'a')).toMatchObject({ day: '2026-10-13', slot: null })
    expect(placed.find((p) => p.id === 'b')!.slot).not.toBeNull()
  })
})
