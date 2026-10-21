import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  isValidTimeZone,
  localDateOf,
  startOfWeek,
  todayIn,
  weekdayOf,
  zonedInstant,
} from './dates.ts'

describe('todayIn', () => {
  it('uses the given timezone, not UTC', () => {
    const lateEveningInLA = new Date('2026-03-01T06:30:00Z') // 22:30 on Feb 28 in Los Angeles
    expect(todayIn('America/Los_Angeles', lateEveningInLA)).toBe('2026-02-28')
    expect(todayIn('UTC', lateEveningInLA)).toBe('2026-03-01')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('localDateOf', () => {
  it('keeps the local date of offset timestamps', () => {
    expect(localDateOf('2026-03-02T07:05:00+09:00', 'America/Los_Angeles')).toBe('2026-03-02')
    expect(localDateOf('2026-03-01T23:30:00-08:00', 'Asia/Tokyo')).toBe('2026-03-01')
  })

  it('converts UTC timestamps with the fallback timezone', () => {
    expect(localDateOf('2026-03-02T06:30:00Z', 'America/Los_Angeles')).toBe('2026-03-01')
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
  })
})

describe('weekdayOf and startOfWeek', () => {
  it('counts weeks from Monday', () => {
    expect(weekdayOf('2026-10-12')).toBe(0) // Monday
    expect(weekdayOf('2026-10-18')).toBe(6) // Sunday
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12')
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12')
  })
})

describe('daysBetween', () => {
  it('counts calendar days in either direction', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    expect(daysBetween('2026-03-02', '2026-02-27')).toBe(-3)
  })
})

describe('zonedInstant', () => {
  it('reads a wall-clock time in the given timezone', () => {
    expect(zonedInstant('2026-10-15', '07:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-10-15T14:30:00.000Z',
    )
    expect(zonedInstant('2026-01-15', '07:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-01-15T15:30:00.000Z',
    )
    expect(zonedInstant('2026-10-15', '07:30', 'Asia/Tokyo').toISOString()).toBe(
      '2026-10-14T22:30:00.000Z',
    )
  })

  it('handles the days clocks change', () => {
    // 02:30 doesn't exist on 2026-03-08 in Los Angeles; 01:30 happens twice on 2026-11-01.
    expect(zonedInstant('2026-03-08', '02:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T09:30:00.000Z',
    )
    expect(zonedInstant('2026-11-01', '01:30', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-01T08:30:00.000Z',
    )
    expect(zonedInstant('2026-03-08', '07:00', 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T14:00:00.000Z',
    )
  })
})
