import { useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import { crisp, labelRoom, linePath, PLOT_RIGHT_MARGIN, useElementWidth, valueTicks } from './charts.ts'
import { timeTicks, type StateRun, type TimedValue } from './time.ts'

const AXIS_HEIGHT = 24
const INSET = 4
/** Arrow keys move the crosshair this far. */
const KEY_STEP_MS = 5 * 60_000

type Shared = {
  /** Read by assistive tech in place of the drawing. */
  label: string
  /** The span of time drawn, as epoch milliseconds. */
  start: number
  end: number
  /** The wearer's timezone, for the time-of-day labels. */
  timeZone: string
  /** Shared by charts over the same span, so their crosshairs move together. */
  activeTime: number | null
  onActiveTimeChange: (time: number | null) => void
}

function useTimeFormat(timeZone: string) {
  return useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }),
    [timeZone],
  )
}

/** Pointer and arrow-key handling that turns positions into times. */
function timeInteraction({
  start,
  end,
  left,
  right,
  activeTime,
  onActiveTimeChange,
}: Pick<Shared, 'start' | 'end' | 'activeTime' | 'onActiveTimeChange'> & {
  left: number
  right: number
}) {
  const timeAt = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - box.left - left) / (right - left)
    return start + Math.min(1, Math.max(0, fraction)) * (end - start)
  }
  return {
    container: {
      tabIndex: 0,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const current = activeTime ?? start
        const next =
          event.key === 'ArrowLeft'
            ? Math.max(start, current - KEY_STEP_MS)
            : event.key === 'ArrowRight'
              ? Math.min(end, current + KEY_STEP_MS)
              : event.key === 'Escape'
                ? null
                : undefined
        if (next === undefined) return
        event.preventDefault()
        onActiveTimeChange(next)
      },
      onBlur: () => onActiveTimeChange(null),
    },
    plot: {
      onPointerDown: (event: PointerEvent<SVGSVGElement>) => onActiveTimeChange(timeAt(event)),
      onPointerMove: (event: PointerEvent<SVGSVGElement>) => onActiveTimeChange(timeAt(event)),
      onPointerLeave: () => onActiveTimeChange(null),
    },
  }
}

function TimeAxis({
  start,
  end,
  x,
  top,
  width,
  timeZone,
}: {
  start: number
  end: number
  x: (time: number) => number
  top: number
  width: number
  timeZone: string
}) {
  const format = useTimeFormat(timeZone)
  const ticks = timeTicks(start, end, timeZone, Math.max(2, Math.min(8, Math.floor(width / 64))))
  return (
    <g className="axis">
      {ticks.map((tick) => (
        <text key={tick} x={x(tick)} y={top + 17} textAnchor="middle">
          {format.format(tick)}
        </text>
      ))}
    </g>
  )
}

/** The point nearest `time`, if one is within `within` milliseconds of it. */
function nearest(points: TimedValue[], time: number, within: number) {
  let best: TimedValue | undefined
  for (const point of points) {
    if (!best || Math.abs(point.time - time) < Math.abs(best.time - time)) best = point
  }
  return best && Math.abs(best.time - time) <= within ? best : undefined
}

/**
 * Values over a span of time as a line, broken where readings stop for more than `maxGapMs`,
 * over shaded `spans` (such as workouts).
 */
export function TimeChart({
  label,
  start,
  end,
  timeZone,
  activeTime,
  onActiveTimeChange,
  points,
  spans = [],
  format,
  tick,
  maxGapMs = 15 * 60_000,
  height = 96,
}: Shared & {
  points: TimedValue[]
  spans?: { start: number; end: number; label: string }[]
  /** A value as read out, and as a value-axis label. */
  format: (value: number) => string
  tick: (value: number) => string
  maxGapMs?: number
  height?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const timeFormat = useTimeFormat(timeZone)
  const present = useMemo(() => points.filter((point) => point.value !== null), [points])

  const layout = useMemo(() => {
    if (present.length === 0 || width === 0) return null
    const values = present.map((point) => point.value ?? 0)
    const ticks = valueTicks(Math.min(...values), Math.max(...values), {
      integers: values.every(Number.isInteger),
    })
    const min = ticks[0]
    const max = ticks[ticks.length - 1]
    const left = labelRoom(ticks.map(tick))
    const right = width - PLOT_RIGHT_MARGIN
    const x = (time: number) => left + ((time - start) / (end - start)) * (right - left)
    const y = (value: number) => INSET + ((max - value) / (max - min)) * (height - 2 * INSET)
    return { ticks, left, right, x, y }
  }, [present, width, height, start, end, tick])

  const drawing = useMemo(() => {
    if (!layout) return null
    const { ticks, left, right, x, y } = layout
    const linePoints: ({ x: number; y: number } | null)[] = []
    let previous: TimedValue | undefined
    for (const point of points) {
      if (point.value === null || (previous && point.time - previous.time > maxGapMs)) {
        linePoints.push(null)
      }
      if (point.value !== null) linePoints.push({ x: x(point.time), y: y(point.value) })
      previous = point.value === null ? undefined : point
    }
    return (
      <>
        {spans.map((span) => (
          <g key={`${span.start}-${span.label}`}>
            <rect
              className="time-span"
              x={x(Math.max(start, span.start))}
              y={0}
              width={Math.max(2, x(Math.min(end, span.end)) - x(Math.max(start, span.start)))}
              height={height}
            />
            <text className="time-span-label" x={x(Math.max(start, span.start)) + 4} y={11}>
              {span.label}
            </text>
          </g>
        ))}
        <g className="grid">
          {ticks.map((value) => (
            <g key={value}>
              <line x1={left} x2={right} y1={crisp(y(value))} y2={crisp(y(value))} />
              <text x={left - 8} y={y(value)} dy="0.32em" textAnchor="end">
                {tick(value)}
              </text>
            </g>
          ))}
        </g>
        <path className="trend-line" d={linePath(linePoints)} />
        <TimeAxis start={start} end={end} x={x} top={height} width={right - left} timeZone={timeZone} />
      </>
    )
  }, [layout, points, spans, start, end, height, maxGapMs, tick, timeZone])

  if (!layout) {
    return (
      <div ref={ref} className="trend-chart empty" style={{ minHeight: height + AXIS_HEIGHT }}>
        {width > 0 && <p className="muted small">No readings.</p>}
      </div>
    )
  }

  const { left, right, x, y } = layout
  const interaction = timeInteraction({ start, end, left, right, activeTime, onActiveTimeChange })
  const active = activeTime === null ? undefined : nearest(present, activeTime, maxGapMs)
  return (
    <div ref={ref} className="time-chart" role="img" aria-label={label} {...interaction.container}>
      <p className="readout small">
        {active?.value != null ? (
          <>
            <strong>{format(active.value)}</strong>{' '}
            <span className="muted">{timeFormat.format(active.time)}</span>
          </>
        ) : (
          ' '
        )}
      </p>
      <svg width={width} height={height + AXIS_HEIGHT} aria-hidden="true" {...interaction.plot}>
        {drawing}
        {activeTime !== null && (
          <line
            className="crosshair"
            x1={crisp(x(activeTime))}
            x2={crisp(x(activeTime))}
            y1={0}
            y2={height}
          />
        )}
        {active?.value != null && (
          <circle className="marker" cx={x(active.time)} cy={y(active.value)} r={4} />
        )}
      </svg>
    </div>
  )
}

/**
 * States over a span of time: one row per state (a hypnogram), or with `strip`, one row colored
 * by state (activity level through the day).
 */
export function StateChart({
  label,
  start,
  end,
  timeZone,
  activeTime,
  onActiveTimeChange,
  runs,
  states,
  strip = false,
  rowHeight = 14,
}: Shared & {
  runs: StateRun[]
  /** Top row first, with the colors they're drawn in. Runs in other states aren't drawn. */
  states: { value: string; label: string; color: string }[]
  strip?: boolean
  rowHeight?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const timeFormat = useTimeFormat(timeZone)
  const rows = strip ? 1 : states.length
  const height = rows * rowHeight
  const left = strip ? 28 : labelRoom(states.map((state) => state.label))
  const right = width - PLOT_RIGHT_MARGIN
  const x = (time: number) => left + ((time - start) / (end - start)) * (right - left)

  const drawing = useMemo(() => {
    if (width === 0) return null
    const xOf = (time: number) => left + ((time - start) / (end - start)) * (right - left)
    return (
      <>
        {!strip &&
          states.map((state, row) => (
            <text
              key={state.value}
              x={left - 8}
              y={row * rowHeight + rowHeight / 2}
              dy="0.32em"
              textAnchor="end"
            >
              {state.label}
            </text>
          ))}
        {runs.map((run) => {
          const row = states.findIndex((state) => state.value === run.state)
          if (row === -1) return null
          return (
            <rect
              key={run.start}
              x={xOf(run.start)}
              y={(strip ? 0 : row) * rowHeight + 1}
              width={Math.max(1, xOf(run.end) - xOf(run.start))}
              height={rowHeight - 2}
              fill={states[row].color}
            />
          )
        })}
        <TimeAxis
          start={start}
          end={end}
          x={xOf}
          top={height}
          width={right - left}
          timeZone={timeZone}
        />
      </>
    )
  }, [width, runs, states, strip, rowHeight, start, end, left, right, height, timeZone])

  const interaction = timeInteraction({ start, end, left, right, activeTime, onActiveTimeChange })
  const active =
    activeTime === null ? undefined : runs.find((run) => run.start <= activeTime && activeTime < run.end)
  const activeState = active && states.find((state) => state.value === active.state)
  return (
    <div
      ref={ref}
      className="time-chart"
      style={{ minHeight: height + AXIS_HEIGHT }}
      role="img"
      aria-label={label}
      {...interaction.container}
    >
      <p className="readout small">
        {activeState && activeTime !== null ? (
          <>
            <strong>{activeState.label}</strong>{' '}
            <span className="muted">{timeFormat.format(activeTime)}</span>
          </>
        ) : (
          ' '
        )}
      </p>
      {width > 0 && (
        <svg width={width} height={height + AXIS_HEIGHT} aria-hidden="true" {...interaction.plot}>
          {drawing}
          {activeTime !== null && (
            <line
              className="crosshair"
              x1={crisp(x(activeTime))}
              x2={crisp(x(activeTime))}
              y1={0}
              y2={height}
            />
          )}
        </svg>
      )}
    </div>
  )
}
