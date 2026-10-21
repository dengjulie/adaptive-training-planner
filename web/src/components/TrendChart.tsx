import { useMemo } from 'react'
import { DayAxis, ValueGrid } from './ChartParts.tsx'
import {
  bandPath,
  crisp,
  DAY_AXIS_HEIGHT,
  labelRoom,
  linePath,
  PLOT_RIGHT_MARGIN,
  useElementWidth,
  valueTicks,
} from './charts.ts'
import { useDayInteraction } from './useDayInteraction.ts'

export type TrendPoint = {
  /** Calendar date (YYYY-MM-DD). Points are consecutive days. */
  day: string
  value: number | null
  /** Shaded behind the line, e.g. the day's normal range. */
  range: { low: number; high: number } | null
  /** Draws the value as a warning marker. */
  flagged: boolean
}

/** Keeps markers on the top and bottom gridlines inside the plot. */
const INSET = 6

/**
 * One value per day as a line over its shaded range, with a crosshair at `activeIndex`. Charts
 * that share an index (small multiples over the same days) move their crosshairs together. The
 * arrow keys move the crosshair when the chart has focus; a click or Enter picks the day.
 *
 * Pass stable `points`, `formatTick`, and `tickSteps` (memoized, or defined outside components):
 * the drawing is memoized on them, so moving the crosshair redraws only the crosshair.
 */
export function TrendChart({
  label,
  points,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  height = 120,
  formatTick = String,
  tickSteps,
  connectGaps = false,
}: {
  /** Read by assistive tech in place of the drawing. */
  label: string
  points: TrendPoint[]
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  onSelect?: (index: number) => void
  /** Height of the plot, without the date labels under it. */
  height?: number
  formatTick?: (value: number) => string
  /** Step sizes for the value axis, smallest first (see valueTicks). */
  tickSteps?: number[]
  /** Join readings across days without one, for values measured every few days. */
  connectGaps?: boolean
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const lastWithValue = points.findLastIndex((point) => point.value !== null)
  const interaction = useDayInteraction({
    count: points.length,
    activeIndex,
    onActiveIndexChange,
    onSelect,
    focusIndex: lastWithValue === -1 ? points.length - 1 : lastWithValue,
  })

  const layout = useMemo(() => {
    const extents = points.flatMap(({ value, range }) => [
      ...(value === null ? [] : [value]),
      ...(range ? [range.low, range.high] : []),
    ])
    if (extents.length === 0 || width === 0) return null
    const integers = points.every(({ value }) => value === null || Number.isInteger(value))
    const ticks = valueTicks(Math.min(...extents), Math.max(...extents), {
      steps: tickSteps,
      integers,
    })
    const min = ticks[0]
    const max = ticks[ticks.length - 1]
    const left = labelRoom(ticks.map(formatTick))
    const right = width - PLOT_RIGHT_MARGIN
    const slot = (right - left) / points.length
    const x = (index: number) => left + (index + 0.5) * slot
    const y = (value: number) => INSET + ((max - value) / (max - min)) * (height - 2 * INSET)
    return { ticks, left, right, slot, x, y }
  }, [points, width, height, tickSteps, formatTick])

  // Everything but the crosshair, so moving it doesn't redraw every chart's line.
  const drawing = useMemo(() => {
    if (!layout) return null
    const { ticks, left, right, slot, x, y } = layout
    const valueAt = (index: number) => points[index]?.value ?? null
    return (
      <>
        <ValueGrid ticks={ticks} left={left} right={right} y={y} formatTick={formatTick} />
        <path
          className="trend-band"
          d={bandPath(
            points.map(({ range }, index) =>
              range ? { x: x(index), top: y(range.high), bottom: y(range.low) } : null,
            ),
          )}
        />
        <path
          className="trend-line"
          d={linePath(
            points.flatMap(({ value }, index) =>
              value === null ? (connectGaps ? [] : [null]) : [{ x: x(index), y: y(value) }],
            ),
          )}
        />
        {points.map((point, index) => {
          if (point.value === null) return null
          // Lone values have no line to sit on (and sparse ones are each a measurement); the
          // latest and the flagged ones get called out too.
          const isolated =
            connectGaps || (valueAt(index - 1) === null && valueAt(index + 1) === null)
          if (!point.flagged && !isolated && index !== lastWithValue) return null
          // At a few pixels a day, full-size dots would merge into a band of their own.
          const r = slot >= 6 || isolated || index === lastWithValue ? 4 : 2.5
          return (
            <circle
              key={point.day}
              className={point.flagged ? 'marker flagged' : 'marker'}
              cx={x(index)}
              cy={y(point.value)}
              r={r}
            />
          )
        })}
        <DayAxis days={points.map((point) => point.day)} x={x} top={height} width={right - left} />
      </>
    )
  }, [layout, points, height, formatTick, lastWithValue, connectGaps])

  if (!layout) {
    return (
      <div ref={ref} className="trend-chart empty" style={{ minHeight: height + DAY_AXIS_HEIGHT }}>
        {width > 0 && <p className="muted small">No data in this period.</p>}
      </div>
    )
  }

  const { left, slot, x, y } = layout
  const active = activeIndex === null ? undefined : points[activeIndex]
  return (
    <div
      ref={ref}
      className={onSelect ? 'trend-chart selectable' : 'trend-chart'}
      style={{ minHeight: height + DAY_AXIS_HEIGHT }}
      role="img"
      aria-label={label}
      {...interaction.container}
    >
      <svg
        width={width}
        height={height + DAY_AXIS_HEIGHT}
        aria-hidden="true"
        {...interaction.plot(left, slot)}
      >
        {drawing}
        {activeIndex !== null && (
          <line
            className="crosshair"
            x1={crisp(x(activeIndex))}
            x2={crisp(x(activeIndex))}
            y1={0}
            y2={height}
          />
        )}
        {activeIndex !== null && active?.value != null && (
          <circle
            className={active.flagged ? 'marker flagged' : 'marker'}
            cx={x(activeIndex)}
            cy={y(active.value)}
            r={5}
          />
        )}
      </svg>
    </div>
  )
}
