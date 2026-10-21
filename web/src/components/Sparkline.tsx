import { linePath, useElementWidth } from './charts.ts'

const HEIGHT = 32
/** Room for the end dot. */
const PAD = 4

/**
 * A glanceable trend: the values in the de-emphasis color with the latest one called out. Unlike
 * TrendChart it joins across missing days, since it shows the shape rather than each day.
 */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const present = values.filter((value): value is number => value !== null)
  const lastIndex = values.findLastIndex((value) => value !== null)
  const lastValue = values[lastIndex] ?? null

  const min = Math.min(...present)
  const max = Math.max(...present)
  const x = (index: number) => PAD + (index / Math.max(1, values.length - 1)) * (width - 2 * PAD)
  const y = (value: number) =>
    max === min ? HEIGHT / 2 : PAD + ((max - value) / (max - min)) * (HEIGHT - 2 * PAD)

  return (
    <div ref={ref} className="sparkline" role="img" aria-label={label}>
      {width > 0 && lastValue !== null && (
        <svg width={width} height={HEIGHT} aria-hidden="true">
          <path
            className="sparkline-line"
            d={linePath(
              values.flatMap((value, index) =>
                value === null ? [] : [{ x: x(index), y: y(value) }],
              ),
            )}
          />
          <circle className="sparkline-dot" cx={x(lastIndex)} cy={y(lastValue)} r={3} />
        </svg>
      )}
    </div>
  )
}
