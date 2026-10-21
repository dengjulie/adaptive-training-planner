import { useMemo } from 'react'
import { DayAxis, ValueGrid } from './ChartParts.tsx'
import {
  crisp,
  DAY_AXIS_HEIGHT,
  labelRoom,
  PLOT_RIGHT_MARGIN,
  useElementWidth,
  valueTicks,
} from './charts.ts'
import { useDayInteraction } from './useDayInteraction.ts'

export type StackLayer = {
  label: string
  /** One per day, aligned with `days`. */
  values: (number | null)[]
  /** A CSS color, e.g. a custom property. */
  color: string
}

/** Bars wider than this cap leave the rest of their day as air. */
const MAX_BAR_WIDTH = 24
const DATA_END_RADIUS = 4

/** A bar segment whose top corners are rounded: the data end of a stacked column. */
function roundedTop(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height)
  const right = x + width
  return [
    `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}`,
    `H${right - r}Q${right},${y} ${right},${y + r}V${y + height}Z`,
  ].join('')
}

/**
 * Parts of a whole per day as stacked columns, first layer at the bottom. Shares `activeIndex`
 * with other charts over the same days, like TrendChart. Pass stable `layers` and `formatTick`.
 */
export function StackedBars({
  label,
  days,
  layers,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  height = 120,
  formatTick = String,
  tickSteps,
}: {
  label: string
  days: string[]
  layers: StackLayer[]
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  onSelect?: (index: number) => void
  height?: number
  formatTick?: (value: number) => string
  tickSteps?: number[]
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const totals = useMemo(
    () => days.map((_, index) => layers.reduce((sum, layer) => sum + (layer.values[index] ?? 0), 0)),
    [days, layers],
  )
  const lastWithValue = totals.findLastIndex((total) => total > 0)
  const interaction = useDayInteraction({
    count: days.length,
    activeIndex,
    onActiveIndexChange,
    onSelect,
    focusIndex: lastWithValue === -1 ? days.length - 1 : lastWithValue,
  })

  const layout = useMemo(() => {
    const max = Math.max(0, ...totals)
    if (max === 0 || width === 0) return null
    const ticks = valueTicks(0, max, { steps: tickSteps })
    const top = ticks[ticks.length - 1]
    const left = labelRoom(ticks.map(formatTick))
    const right = width - PLOT_RIGHT_MARGIN
    const slot = (right - left) / days.length
    const x = (index: number) => left + (index + 0.5) * slot
    const y = (value: number) => height - (value / top) * height
    return { ticks, left, right, slot, x, y }
  }, [totals, width, height, tickSteps, formatTick, days.length])

  const drawing = useMemo(() => {
    if (!layout) return null
    const { ticks, left, right, slot, x, y } = layout
    const barWidth = Math.max(1, Math.min(MAX_BAR_WIDTH, slot * 0.7))
    // A surface-colored gap between segments, once bars are wide enough to show one.
    const gap = barWidth >= 6 ? 2 : 0
    return (
      <>
        <ValueGrid ticks={ticks} left={left} right={right} y={y} formatTick={formatTick} />
        {days.map((day, index) => {
          const present = layers.filter((layer) => (layer.values[index] ?? 0) > 0)
          let base = 0
          return (
            <g key={day}>
              {present.map((layer, position) => {
                const value = layer.values[index] ?? 0
                const top = y(base + value)
                const bottom = y(base) - (position > 0 ? gap : 0)
                base += value
                const barHeight = Math.max(0, bottom - top)
                const isTop = position === present.length - 1
                return isTop && barWidth >= 8 ? (
                  <path
                    key={layer.label}
                    d={roundedTop(x(index) - barWidth / 2, top, barWidth, barHeight, DATA_END_RADIUS)}
                    fill={layer.color}
                  />
                ) : (
                  <rect
                    key={layer.label}
                    x={x(index) - barWidth / 2}
                    y={top}
                    width={barWidth}
                    height={barHeight}
                    fill={layer.color}
                  />
                )
              })}
            </g>
          )
        })}
        <DayAxis days={days} x={x} top={height} width={right - left} />
      </>
    )
  }, [layout, days, layers, height, formatTick])

  if (!layout) {
    return (
      <div ref={ref} className="trend-chart empty" style={{ minHeight: height + DAY_AXIS_HEIGHT }}>
        {width > 0 && <p className="muted small">No data in this period.</p>}
      </div>
    )
  }

  const { left, slot, x } = layout
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
      </svg>
    </div>
  )
}
