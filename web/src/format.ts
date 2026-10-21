const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** 12,345 */
export const formatCount = (value: number) => numberFormat.format(value)

/** 36.5, 0.2 */
export const formatDecimal = (value: number) => decimalFormat.format(value)

/** Seconds as "7h 32m", "7h", "45m", or "30s". */
export function formatDuration(seconds: number) {
  if (seconds === 0) return '0'
  if (Math.abs(seconds) < 60) return `${Math.round(seconds)}s`
  const sign = seconds < 0 ? '-' : ''
  const totalMinutes = Math.round(Math.abs(seconds) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${sign}${minutes}m`
  return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`
}

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

/** Seconds from midnight (negative for the evening before) as a time of day: "11:10 PM". */
export function formatClock(secondsFromMidnight: number) {
  const day = 86_400
  const wrapped = ((Math.round(secondsFromMidnight) % day) + day) % day
  return clockFormat.format(new Date(wrapped * 1000))
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * The local time an Oura timestamp carries ("2026-03-01T23:10:00-08:00" reads 11:10 PM), however
 * far the browser's timezone is from the wearer's.
 */
export function formatLocalTime(timestamp: string) {
  const match = /T(\d{2}):(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) return timeFormat.format(new Date(timestamp))
  const [, hours, minutes, seconds] = match
  return formatClock(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds))
}

/** snake_case enumeration as words: "follow_optimal_bedtime" reads "Follow optimal bedtime". */
export function humanize(value: string) {
  const words = value.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
