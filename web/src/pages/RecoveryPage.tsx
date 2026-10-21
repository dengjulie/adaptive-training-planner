import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { connectUrl, useMe } from '../api.ts'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { usePeriod } from '../components/period.ts'
import { TrendChart, type TrendPoint } from '../components/TrendChart.tsx'
import { RangeStatus, StatValue } from '../integrations/OuraStat.tsx'
import {
  dayLabel,
  formatRange,
  formatValue,
  hasAnyValue,
  isWorse,
  latestIndex,
  METRIC_INFO,
  OURA_METRICS,
  positionIn,
  useOuraDays,
  useOuraSync,
  type OuraDay,
  type OuraMetric,
} from '../integrations/oura.ts'

export function RecoveryPage() {
  const { data: me } = useMe()
  const oura = me?.integrations.find((integration) => integration.provider === 'oura')
  const daily = useOuraDays({ enabled: oura?.connected ?? false })
  const sync = useOuraSync()
  const navigate = useNavigate()
  const [period, setPeriod] = usePeriod()
  // The day under the crosshair, shared by every chart; null shows each metric's latest value.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const days = useMemo(() => daily.data?.slice(-period) ?? [], [daily.data, period])
  // Memoized so the charts redraw only their crosshairs while it moves.
  const points = useMemo(
    () =>
      Object.fromEntries(
        OURA_METRICS.map((metric) => [
          metric,
          days.map(
            (day): TrendPoint => ({
              day: day.day,
              value: day[metric],
              range: day.normalRange[metric],
              flagged: isWorse(metric, day[metric], day.normalRange[metric]),
            }),
          ),
        ]),
      ) as Record<OuraMetric, TrendPoint[]>,
    [days],
  )
  const openDay = (index: number) => {
    const day = days[index]
    if (day) navigate(`/oura/${day.day}`)
  }

  if (!oura?.connected) {
    return (
      <>
        <h1>Recovery</h1>
        <div className="card">
          <p>Connect Oura to see your readiness, HRV, and resting heart rate over time.</p>
          <div className="actions">
            <Link className="button primary" to="/connections">
              Go to Connections
            </Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <h1>Recovery</h1>
      <p className="lede">
        Readiness, HRV, and resting heart rate from Oura. Each day is compared with your normal
        range: the average of the 30 days before it, plus or minus one standard deviation.
      </p>

      {oura.status === 'reauth_required' && (
        <p className="notice warn">
          Oura needs to be reconnected, so these numbers may be out of date.{' '}
          <a href={connectUrl('oura')}>Reconnect</a>
        </p>
      )}

      <div className="toolbar">
        <PeriodPicker
          days={period}
          onChange={(days) => {
            setActiveIndex(null)
            setPeriod(days)
          }}
        />
        <button
          type="button"
          className="button subtle"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {sync.error && <ErrorMessage error={sync.error} />}

      {daily.isPending ? (
        <p className="muted">Loading…</p>
      ) : daily.isError ? (
        <ErrorMessage error={daily.error} />
      ) : !hasAnyValue(daily.data) ? (
        <p className="muted">No Oura data yet. Sync to pull the last year.</p>
      ) : (
        <div className={daily.isFetching ? 'refreshing' : undefined}>
          <ChartKey />
          <div className="cards">
            {OURA_METRICS.map((metric) => (
              <section key={metric} className="card metric-row">
                <MetricStat metric={metric} days={days} index={activeIndex} />
                <TrendChart
                  label={chartLabel(metric, days)}
                  points={points[metric]}
                  activeIndex={activeIndex}
                  onActiveIndexChange={setActiveIndex}
                  onSelect={openDay}
                />
              </section>
            ))}
            <DailyValues days={days} />
          </div>
        </div>
      )}
    </>
  )
}

function ChartKey() {
  return (
    <ul className="chart-key small muted" aria-label="Chart key">
      <li>
        <svg width="16" height="10" aria-hidden="true">
          <line className="trend-line" x1="1" x2="15" y1="5" y2="5" />
        </svg>
        Daily value
      </li>
      <li>
        <svg width="16" height="10" aria-hidden="true">
          <rect className="trend-band" width="16" height="10" rx="2" />
        </svg>
        Normal range
      </li>
      <li>
        <svg width="12" height="12" aria-hidden="true">
          <circle className="marker flagged" cx="6" cy="6" r="4" />
        </svg>
        Low readiness or HRV, or high resting heart rate
      </li>
    </ul>
  )
}

/** The metric on the day under the crosshair, or its latest value when there's none. */
function MetricStat({
  metric,
  days,
  index,
}: {
  metric: OuraMetric
  days: OuraDay[]
  index: number | null
}) {
  const shown = index ?? latestIndex(days, metric)
  const day: OuraDay | undefined = days[shown]
  const value = day?.[metric] ?? null
  const range = day?.normalRange[metric] ?? null

  return (
    <div className="metric-stat">
      <h2>{METRIC_INFO[metric].label}</h2>
      <StatValue metric={metric} value={value} />
      <RangeStatus metric={metric} value={value} range={range} />
      <p className="small muted">
        {day ? dayLabel(days, shown) : `No data in the last ${days.length} days`}
      </p>
      {day && (
        <p className="small muted">
          {range ? `Normal ${formatRange(metric, range)}` : 'Not enough nights yet for a normal range'}
        </p>
      )}
    </div>
  )
}

function chartLabel(metric: OuraMetric, days: OuraDay[]) {
  const { label } = METRIC_INFO[metric]
  const latest: OuraDay | undefined = days[latestIndex(days, metric)]
  if (!latest) return `${label}: no data in the last ${days.length} days.`
  const range = latest.normalRange[metric]
  const normal = range ? `, normal range ${formatRange(metric, range)}` : ''
  return (
    `${label} over the last ${days.length} days. Latest ${formatValue(metric, latest[metric])}` +
    `${normal}. Daily values are in the table below.`
  )
}

/** The charts' data as a table, newest first: the view that doesn't depend on seeing them. */
function DailyValues({ days }: { days: OuraDay[] }) {
  const rows = days.map((day, index) => ({ day, index })).reverse()
  return (
    <details className="card">
      <summary>Daily values</summary>
      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Day</th>
              {OURA_METRICS.map((metric) => (
                <th key={metric}>{METRIC_INFO[metric].shortLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ day, index }) => (
              <tr key={day.day}>
                <td>{dayLabel(days, index)}</td>
                {OURA_METRICS.map((metric) => {
                  const value = day[metric]
                  const range = day.normalRange[metric]
                  const outside = value !== null && range && positionIn(range, value) !== 'normal'
                  return (
                    <td key={metric}>
                      {formatValue(metric, value)}
                      {outside && <RangeStatus metric={metric} value={value} range={range} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
