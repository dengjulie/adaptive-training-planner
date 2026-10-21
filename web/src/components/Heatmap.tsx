import { useMemo } from 'react'
import { DayAxis } from './ChartParts.tsx'
import { DAY_AXIS_HEIGHT, labelRoom, PLOT_RIGHT_MARGIN, useElementWidth } from './charts.ts'
import { useDayInteraction } from './useDayInteraction.ts'

export type HeatmapRow<T> = {
  label: string
  /** One per day, aligned with `days`; null leaves the cell empty. */
  values: (T | null)[]
}

/**
 * A grid of days (columns) by rows, each cell colored by its value: contributor scores over
 * time, or with a single row, a strip of daily categories. Shares `activeIndex` with other
 * charts over the same days, like TrendChart. Pass stable `rows` and `colorOf`.
 */
export function Heatmap<T extends number | string>({
  label,
  days,
  rows,
  colorOf,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  rowHeight = 16,
}: {
  label: string
  days: string[]
  rows: HeatmapRow<T>[]
  /** A CSS color for a value, e.g. a custom property. */
  colorOf: (value: T) => string
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  onSelect?: (index: number) => void
  rowHeight?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const height = rows.length * rowHeight
  const lastWithValue = days.findLastIndex((_, index) => rows.some((row) => row.values[index] != null))
  const interaction = useDayInteraction({
    count: days.length,
    activeIndex,
    onActiveIndexChange,
    onSelect,
    focusIndex: lastWithValue === -1 ? days.length - 1 : lastWithValue,
  })

  const layout = useMemo(() => {
    if (width === 0) return null
    const left = labelRoom(rows.map((row) => row.label))
    const right = width - PLOT_RIGHT_MARGIN
    const slot = (right - left) / days.length
    const x = (index: number) => left + (index + 0.5) * slot
    return { left, right, slot, x }
  }, [width, rows, days.length])

  const drawing = useMemo(() => {
    if (!layout) return null
    const { left, right, slot, x } = layout
    // Cells a few pixels wide get a hairline of surface between them; narrower ones touch.
    const gap = slot >= 4 ? 1 : 0
    return (
      <>
        {rows.map((row, rowIndex) => (
          <g key={row.label}>
            <text x={left - 8} y={rowIndex * rowHeight + rowHeight / 2} dy="0.32em" textAnchor="end">
              {row.label}
            </text>
            {row.values.map((value, index) =>
              value === null ? null : (
                <rect
                  key={index}
                  x={left + index * slot}
                  y={rowIndex * rowHeight + 1}
                  width={Math.max(0.5, slot - gap)}
                  height={rowHeight - 2}
                  fill={colorOf(value)}
                />
              ),
            )}
          </g>
        ))}
        <DayAxis days={days} x={x} top={height} width={right - left} />
      </>
    )
  }, [layout, rows, days, colorOf, rowHeight, height])

  if (!layout) {
    return <div ref={ref} className="trend-chart" style={{ minHeight: height + DAY_AXIS_HEIGHT }} />
  }

  const { left, slot } = layout
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
          <rect
            className="heatmap-focus"
            x={left + activeIndex * slot - 1}
            y={0}
            width={Math.max(2, slot) + 2}
            height={height}
            rx={2}
          />
        )}
      </svg>
    </div>
  )
}
