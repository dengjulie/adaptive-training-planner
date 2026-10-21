const MINUTE_MS = 60_000

/** The zone's UTC offset in minutes at an instant: -420 for 7 hours behind UTC. */
export function offsetMinutes(timeZone: string, at: number) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name ?? '')
  if (!match) return 0 // "GMT" alone: UTC
  const [, sign, hours, minutes = '0'] = match
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes))
}

/** The instant a calendar day (YYYY-MM-DD) starts in a timezone. */
export function startOfDay(day: string, timeZone: string) {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`)
  // The offset at local midnight, found from the offset near it (they differ only across DST).
  const guess = utcMidnight - offsetMinutes(timeZone, utcMidnight) * MINUTE_MS
  return utcMidnight - offsetMinutes(timeZone, guess) * MINUTE_MS
}

const TICK_STEPS_MINUTES = [5, 10, 15, 30, 60, 120, 180, 240, 360]

/** Round local times of day between two instants, at most `maxLabels` of them. */
export function timeTicks(start: number, end: number, timeZone: string, maxLabels: number) {
  const offset = offsetMinutes(timeZone, start) * MINUTE_MS
  const spanMinutes = (end - start) / MINUTE_MS
  const step =
    (TICK_STEPS_MINUTES.find((minutes) => spanMinutes / minutes <= maxLabels) ?? 360) * MINUTE_MS
  const ticks: number[] = []
  for (let local = Math.ceil((start + offset) / step) * step; local - offset <= end; local += step) {
    ticks.push(local - offset)
  }
  return ticks
}

export type TimedValue = { time: number; value: number | null }

/** Oura's samples: values every `interval` seconds from `timestamp`, null where none was read. */
export function samplePoints(sample: {
  interval: number
  items: (number | null)[]
  timestamp: string
}): TimedValue[] {
  const start = Date.parse(sample.timestamp)
  return sample.items.map((value, index) => ({
    time: start + index * sample.interval * 1000,
    value,
  }))
}

export type StateRun = { start: number; end: number; state: string }

/**
 * Oura's per-interval encodings ("4443322111", one character every `intervalSeconds` from
 * `start`) as runs of the same state.
 */
export function stateRuns(encoded: string, start: number, intervalSeconds: number): StateRun[] {
  const runs: StateRun[] = []
  const step = intervalSeconds * 1000
  for (let index = 0; index < encoded.length; index++) {
    const state = encoded.charAt(index)
    const previous = runs.at(-1)
    if (previous && previous.state === state) previous.end += step
    else runs.push({ start: start + index * step, end: start + (index + 1) * step, state })
  }
  return runs
}
