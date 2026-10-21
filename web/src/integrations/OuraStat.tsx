import {
  formatNumber,
  METRIC_INFO,
  positionIn,
  type NormalRange,
  type OuraMetric,
  type RangePosition,
} from './oura.ts'

const POSITIONS: Record<RangePosition, { label: string; icon: string }> = {
  low: { label: 'Low', icon: 'M6 2.5v7M2.75 6.25 6 9.5l3.25-3.25' },
  normal: { label: 'Normal', icon: 'M2.5 6.25 5 8.75l4.5-5' },
  high: { label: 'High', icon: 'M6 9.5v-7M2.75 5.75 6 2.5l3.25 3.25' },
}

/**
 * Where a value sits against its normal range. Only the side that counts against recovery
 * (low readiness or HRV, high resting heart rate) gets the warning color.
 */
export function RangeStatus({
  metric,
  value,
  range,
}: {
  metric: OuraMetric
  value: number | null
  range: NormalRange | null
}) {
  if (value === null) return null
  if (!range) return <span className="pill neutral">No range yet</span>

  const position = positionIn(range, value)
  const tone =
    position === 'normal' ? 'ok' : position === METRIC_INFO[metric].worseWhen ? 'warn' : 'neutral'
  return (
    <span className={`pill ${tone}`}>
      <svg className="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d={POSITIONS[position].icon} />
      </svg>
      {POSITIONS[position].label}
    </span>
  )
}

export function StatValue({ metric, value }: { metric: OuraMetric; value: number | null }) {
  const { unit } = METRIC_INFO[metric]
  return (
    <p className="stat-value">
      {formatNumber(value)}
      {unit && value !== null && <span className="unit">{unit}</span>}
    </p>
  )
}
