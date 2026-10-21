/** Calendar dates are handled as `YYYY-MM-DD` strings to avoid timezone drift. */
export type IsoDate = string

// Creating a formatter is slow next to using one, and a year of heart rate is ~100k samples.
const dayFormatters = new Map<string, Intl.DateTimeFormat>()

function dayFormatter(timeZone: string) {
  let formatter = dayFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayFormatters.set(timeZone, formatter)
  }
  return formatter
}

/** Today's date in an IANA timezone; with `now`, the date of that instant there. */
export function todayIn(timeZone: string, now = new Date()): IsoDate {
  const parts = dayFormatter(timeZone).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: IsoDate, days: number): IsoDate {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The local calendar date of a timestamp. Timestamps with a UTC offset (as Oura and COROS
 * send them) already carry the wearer's local time, so the date part is used as-is; that stays
 * correct while traveling. Timestamps without an offset, or in UTC, use `fallbackTimeZone`.
 */
export function localDateOf(timestamp: string, fallbackTimeZone: string): IsoDate {
  if (/T.*[+-]\d{2}:?\d{2}$/.test(timestamp)) return timestamp.slice(0, 10)
  return todayIn(fallbackTimeZone, new Date(timestamp))
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Day of the week, 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function weekdayOf(day: IsoDate): Weekday {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) as Weekday
}

/** The Monday of the week a day falls in. */
export function startOfWeek(day: IsoDate): IsoDate {
  return addDays(day, -weekdayOf(day))
}

/** Whole days from `from` to `to`: 1 for consecutive days, negative if `to` comes first. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

/** How far ahead of UTC a timezone's clocks are at an instant, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string) {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The instant a wall-clock time ("07:30") on a day happens in an IANA timezone. A time skipped by
 * a DST change reads as the hour before it (02:30 becomes 01:30); a repeated one, its first time.
 */
export function zonedInstant(day: IsoDate, time: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const wall = Date.UTC(year!, month! - 1, date!, hours!, minutes!)
  // Guess the offset from the wall time read as UTC, then correct it once for DST.
  let instant = wall - zoneOffsetMs(wall, timeZone)
  instant = wall - zoneOffsetMs(instant, timeZone)
  return new Date(instant)
}
