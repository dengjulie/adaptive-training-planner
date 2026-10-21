import type { IsoDate } from '../../lib/dates.ts'

export type CorosActivity = {
  /** 18-digit COROS ID. Kept as a string: it doesn't fit in a JS number. */
  labelId: string
  sportType: number | null
  name: string
  /** Local date COROS assigns the activity. */
  date: IsoDate
  startTime: string | null
  endTime: string | null
  durationSeconds: number | null
  distanceKm: number | null
  averageHeartRate: number | null
}

// "1. Indoor Run — 2026-03-08"
const HEADER = /^\s*\d+\.\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/

/** "35:00" or "1:10:05" → seconds. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function toActivity(name: string, date: IsoDate, block: string): CorosActivity {
  const find = (pattern: RegExp) => pattern.exec(block)?.[1]
  const number = (pattern: RegExp) => {
    const value = find(pattern)
    return value === undefined ? null : Number(value)
  }
  const isoFromUnix = (seconds: number | null) =>
    seconds === null ? null : new Date(seconds * 1000).toISOString()

  return {
    labelId: find(/LabelId:\s*(\d+)/) ?? '',
    sportType: number(/SportType:\s*(\d+)/),
    name,
    date,
    startTime: isoFromUnix(number(/startTimestamp=(\d+)/)),
    endTime: isoFromUnix(number(/endTimestamp=(\d+)/)),
    durationSeconds: parseDuration(find(/Duration:\s*([\d:]+)/)),
    distanceKm: number(/Distance:\s*([\d.]+)\s*km/),
    averageHeartRate: number(/Avg HR:\s*(\d+)\s*bpm/),
  }
}

/**
 * Parses the text `querySportRecords` returns. COROS formats it for language models rather than
 * code, so each field is matched on its own; lines sometimes wrap mid-record.
 */
export function parseSportRecords(text: string): CorosActivity[] {
  const activities: CorosActivity[] = []
  let current: { name: string; date: IsoDate; lines: string[] } | undefined
  const flush = () => {
    if (current) activities.push(toActivity(current.name, current.date, current.lines.join('\n')))
  }

  for (const line of text.split('\n')) {
    const header = HEADER.exec(line)
    if (header) {
      flush()
      current = { name: header[1] ?? '', date: header[2] ?? '', lines: [] }
    } else {
      current?.lines.push(line)
    }
  }
  flush()
  return activities.filter((activity) => activity.labelId !== '')
}
