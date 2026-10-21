import { crisp, dayTicks } from './charts.ts'

const dayTickFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC', // days are calendar dates, not instants
})

/** Horizontal gridlines with their labels on the left. */
export function ValueGrid({
  ticks,
  left,
  right,
  y,
  formatTick,
}: {
  ticks: number[]
  left: number
  right: number
  y: (value: number) => number
  formatTick: (value: number) => string
}) {
  return (
    <g className="grid">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={crisp(y(tick))} y2={crisp(y(tick))} />
          <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Date labels under a plot of consecutive `days`, as many as fit in `width`. */
export function DayAxis({
  days,
  x,
  top,
  width,
}: {
  days: string[]
  x: (index: number) => number
  top: number
  width: number
}) {
  const maxLabels = Math.max(2, Math.min(8, Math.floor(width / 64)))
  return (
    <g className="axis">
      {dayTicks(days.length, maxLabels).map((index) => (
        <text key={index} x={x(index)} y={top + 17} textAnchor="middle">
          {dayTickFormat.format(new Date(days[index]))}
        </text>
      ))}
    </g>
  )
}

/** Swatches naming each series, shaped like its marks. */
export function Legend({
  items,
  shape = 'rect',
}: {
  items: { label: string; color: string }[]
  shape?: 'rect' | 'line'
}) {
  return (
    <ul className="chart-key small muted">
      {items.map(({ label, color }) => (
        <li key={label}>
          <svg width="12" height="10" aria-hidden="true">
            {shape === 'line' ? (
              <line x1="1" x2="11" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
            ) : (
              <rect width="10" height="10" rx="2" fill={color} />
            )}
          </svg>
          {label}
        </li>
      ))}
    </ul>
  )
}
