import { useLayoutEffect, useRef, useState } from 'react'

/** An element's content width, so charts draw at real pixel sizes and text never scales. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Hairlines land on whole pixels so they stay one pixel wide. */
export const crisp = (position: number) => Math.round(position) + 0.5

/** Room for the longest of `labels` at 11px, about 6.3px a character, plus a gap. */
export const labelRoom = (labels: string[], minimum = 28) =>
  Math.max(minimum, Math.ceil(Math.max(0, ...labels.map((label) => label.length)) * 6.3) + 10)

/** Space on the right of day-by-day plots, so the last date label fits. */
export const PLOT_RIGHT_MARGIN = 16

/** Height of the date labels under day-by-day plots. */
export const DAY_AXIS_HEIGHT = 24

/** 1, 2, and 5 times powers of ten around a quarter of the span, smallest first. */
function roundSteps(span: number, integers: boolean): number[] {
  const magnitude = 10 ** Math.floor(Math.log10(span > 0 ? span / 4 : 1))
  const steps = [1, 2, 5, 10, 20, 50].map((multiple) => multiple * magnitude)
  return integers ? steps.filter((step) => step >= 1) : steps
}

/** Seconds: from 10 minutes up to 12 hours, for durations and times of day. */
export const TIME_STEPS = [600, 900, 1800, 3600, 7200, 10800, 21600, 43200]

/**
 * Round ticks covering `min` to `max` in at most four steps. `steps` lists the step sizes to try,
 * smallest first; by default round numbers sized to the span, whole ones if `integers`.
 */
export function valueTicks(
  min: number,
  max: number,
  { steps, integers = false }: { steps?: number[]; integers?: boolean } = {},
): number[] {
  const candidates = steps ?? roundSteps(max - min, integers)
  for (const step of candidates) {
    let first = Math.floor(min / step) * step
    let last = Math.ceil(max / step) * step
    if (first === last) {
      first -= step
      last += step
    }
    const count = Math.round((last - first) / step)
    if (count <= 4 || step === candidates.at(-1)) {
      // Rounded to the step's precision, so 0.1 * 3 reads 0.3.
      const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1)
      return Array.from({ length: count + 1 }, (_, i) => Number((first + i * step).toFixed(decimals)))
    }
  }
  return [min, max]
}

// Weeks and multiples of them, so labels stay on today's weekday; a year fits at 12 weeks.
const DAY_STEPS = [1, 2, 7, 14, 28, 56, 84, 182, 364]

/**
 * Which of `count` days to label: at most `maxLabels`, counting back from the last day in whole
 * steps so weekly labels land on today's weekday.
 */
export function dayTicks(count: number, maxLabels: number): number[] {
  const step = DAY_STEPS.find((s) => Math.ceil(count / s) <= maxLabels) ?? 364
  const indexes: number[] = []
  for (let i = count - 1; i >= 0; i -= step) indexes.unshift(i)
  return indexes
}

type Point = { x: number; y: number }

/** A line through the points, lifted wherever a point is missing so gaps stay visible. */
export function linePath(points: (Point | null)[]): string {
  let path = ''
  let drawing = false
  for (const point of points) {
    if (point) path += `${drawing ? 'L' : 'M'}${point.x},${point.y}`
    drawing = point !== null
  }
  return path
}

type Span = { x: number; top: number; bottom: number }

/** Filled areas between `top` and `bottom`, one per unbroken run of spans. */
export function bandPath(spans: (Span | null)[]): string {
  const runs: Span[][] = []
  let run: Span[] = []
  for (const span of [...spans, null]) {
    if (span) {
      run.push(span)
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  return runs
    .map((spansInRun) => {
      const top = spansInRun.map(({ x, top }) => `${x},${top}`)
      const bottom = spansInRun.map(({ x, bottom }) => `${x},${bottom}`).reverse()
      return `M${top.join('L')}L${bottom.join('L')}Z`
    })
    .join('')
}
