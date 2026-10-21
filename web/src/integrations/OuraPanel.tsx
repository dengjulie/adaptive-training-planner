import { Link } from 'react-router'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { RangeStatus, StatValue } from './OuraStat.tsx'
import {
  dayLabel,
  hasAnyValue,
  latestIndex,
  METRIC_INFO,
  OURA_METRICS,
  useOuraDays,
  useOuraProfile,
  useOuraSync,
  type OuraDay,
  type OuraMetric,
} from './oura.ts'

const SUMMARY_DAYS = 14

export function OuraPanel() {
  const daily = useOuraDays()
  const profile = useOuraProfile()
  const sync = useOuraSync()
  const email = profile.data?.personalInfo?.email

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Last {SUMMARY_DAYS} days</h3>
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
        <p className="muted small">Loading…</p>
      ) : daily.isError ? (
        <ErrorMessage error={daily.error} />
      ) : !hasAnyValue(daily.data) ? (
        <p className="muted small">No data yet. Sync to pull the last year.</p>
      ) : (
        <>
          <div className="stat-tiles">
            {OURA_METRICS.map((metric) => (
              <StatTile key={metric} metric={metric} days={daily.data.slice(-SUMMARY_DAYS)} />
            ))}
          </div>
          <p className="small">
            <Link to="/recovery">See trends against your normal range</Link> ·{' '}
            <Link to="/oura">All Oura data</Link>
            {typeof email === 'string' && <span className="muted"> · Oura account {email}</span>}
          </p>
        </>
      )}
    </div>
  )
}

function StatTile({ metric, days }: { metric: OuraMetric; days: OuraDay[] }) {
  const { label } = METRIC_INFO[metric]
  const index = latestIndex(days, metric)
  const day: OuraDay | undefined = days[index]
  const value = day?.[metric] ?? null

  return (
    <div className="stat-tile">
      <div className="stat-tile-header">
        <span>{label}</span>
        <RangeStatus metric={metric} value={value} range={day?.normalRange[metric] ?? null} />
      </div>
      <StatValue metric={metric} value={value} />
      <Sparkline values={days.map((d) => d[metric])} label={`${label}, last ${days.length} days`} />
      <p className="small muted">{day ? dayLabel(days, index) : 'No data'}</p>
    </div>
  )
}
