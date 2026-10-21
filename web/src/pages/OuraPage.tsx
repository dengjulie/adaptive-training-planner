import { memo, useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { connectUrl, useMe } from '../api.ts'
import { Legend } from '../components/ChartParts.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { Heatmap } from '../components/Heatmap.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { usePeriod } from '../components/period.ts'
import { StackedBars } from '../components/StackedBars.tsx'
import { TrendChart, type TrendPoint } from '../components/TrendChart.tsx'
import { formatCount, formatDecimal, formatDuration, formatLocalTime, humanize } from '../format.ts'
import {
  describeDay,
  formatShortDay,
  useOuraProfile,
  useOuraSync,
  useOuraTrends,
  type ListedCollection,
  type OuraDocument,
  type OuraProfile,
  type OuraTrends,
} from '../integrations/oura.ts'
import {
  as,
  type BatterySample,
  type EnhancedTag,
  type PersonalInfo,
  type RestModePeriod,
  type RingConfiguration,
  type Session,
  type Tag,
  type Workout,
  secondsBetween,
  tagCodeName,
  tagName,
} from '../integrations/ouraDocuments.ts'
import {
  CONTRIBUTOR_LEGEND,
  contributorColor,
  labelForKey,
  otherLabels,
  otherSeries,
  SECTIONS,
  UNITS,
  type ChartSpec,
  type HeatmapSpec,
  type LineSpec,
  type StackSpec,
  type StripSpec,
} from '../integrations/ouraMetrics.ts'

/** The trends for the chosen period: the last `period` days of everything. */
type View = {
  days: string[]
  series: Record<string, (number | null)[]>
  labels: Record<string, (string | null)[]>
  lists: Record<ListedCollection, OuraDocument[]>
}

const DAY_FIELD: Record<ListedCollection, string> = {
  workout: 'day',
  session: 'day',
  tag: 'day',
  enhanced_tag: 'start_day',
  rest_mode_period: 'start_day',
}

function viewOf(trends: OuraTrends, period: number): View {
  const start = Math.max(0, trends.days.length - period)
  const days = trends.days.slice(start)
  const first = days[0] ?? ''
  const slice = <T,>(byKey: Record<string, T[]>) =>
    Object.fromEntries(Object.entries(byKey).map(([key, values]) => [key, values.slice(start)]))
  const lists = Object.fromEntries(
    Object.entries(trends.lists).map(([collection, documents]) => [
      collection,
      documents.filter((document) => {
        const day = document[DAY_FIELD[collection as ListedCollection]]
        return typeof day === 'string' && day >= first
      }),
    ]),
  ) as View['lists']
  return { days, series: slice(trends.series), labels: slice(trends.labels), lists }
}

/** Charts whose data Oura has sent at all in the year, so missing features don't fill the page. */
function hasData(chart: ChartSpec, trends: OuraTrends) {
  const any = (key: string) => trends.series[key]?.some((value) => value !== null) ?? false
  switch (chart.kind) {
    case 'line':
      return (chart.key !== undefined && any(chart.key)) || (chart.band !== undefined && any(chart.band.low))
    case 'stack':
      return chart.layers.some((layer) => any(layer.key))
    case 'heatmap':
      return chart.rows.some((row) => any(row.key))
    case 'strip':
      return trends.labels[chart.key]?.some((value) => value !== null) ?? false
  }
}

type ChartProps = {
  view: View
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  onSelect: (index: number) => void
}

export function OuraPage() {
  const { data: me } = useMe()
  const oura = me?.integrations.find((integration) => integration.provider === 'oura')
  const connected = oura?.connected ?? false
  const trends = useOuraTrends({ enabled: connected })
  const profile = useOuraProfile({ enabled: connected })
  const sync = useOuraSync()
  const navigate = useNavigate()
  const [period, setPeriod] = usePeriod()
  // The day under the crosshair, shared by every chart; null shows each chart's latest value.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const view = useMemo(() => trends.data && viewOf(trends.data, period), [trends.data, period])
  const openDay = useCallback(
    (index: number) => {
      const day = view?.days[index]
      if (day) navigate(`/oura/${day}`)
    },
    [view, navigate],
  )
  const more = useMemo(
    () => (trends.data ? otherSeries(Object.keys(trends.data.series)) : []),
    [trends.data],
  )
  const moreLabels = useMemo(
    () => (trends.data ? otherLabels(Object.keys(trends.data.labels)) : []),
    [trends.data],
  )

  if (!connected) {
    return (
      <>
        <h1>Oura data</h1>
        <div className="card">
          <p>Connect Oura to see everything your ring records.</p>
          <div className="actions">
            <Link className="button primary" to="/connections">
              Go to Connections
            </Link>
          </div>
        </div>
      </>
    )
  }

  const chartProps = view && {
    view,
    activeIndex,
    onActiveIndexChange: setActiveIndex,
    onSelect: openDay,
  }
  return (
    <>
      <h1>Oura data</h1>
      <p className="lede">
        Everything your Oura Ring records, kept for a year. Point at any chart to read a day across
        all of them, or click to open that day.
      </p>

      {oura?.status === 'reauth_required' && (
        <p className="notice warn">
          Oura needs to be reconnected, so this may be out of date.{' '}
          <a href={connectUrl('oura')}>Reconnect</a>
        </p>
      )}
      {profile.data && <SyncNotices profile={profile.data} />}

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

      {trends.isPending ? (
        <p className="muted">Loading…</p>
      ) : trends.isError ? (
        <ErrorMessage error={trends.error} />
      ) : !chartProps ? null : (
        <div className={trends.isFetching ? 'refreshing' : undefined}>
          {profile.data && <ProfileCard profile={profile.data} />}
          {SECTIONS.map(({ title, charts }) => {
            const shown = charts.filter((chart) => hasData(chart, trends.data))
            const empty = charts.filter((chart) => !hasData(chart, trends.data))
            if (shown.length === 0) return null
            return (
              <section key={title} className="oura-section">
                <h2>{title}</h2>
                <div className="chart-grid">
                  {shown.map((chart) => (
                    <ChartCard key={chart.label} chart={chart} {...chartProps} />
                  ))}
                </div>
                {empty.length > 0 && (
                  <p className="small muted">
                    Nothing from Oura yet for {empty.map((chart) => chart.label).join(', ')}.
                  </p>
                )}
              </section>
            )
          })}
          <Workouts {...chartProps} />
          <ListSections view={view} />
          {more.length > 0 && (
            <section className="oura-section">
              <h2>More</h2>
              <p className="small muted">Everything else Oura sends, as it names it.</p>
              <div className="chart-grid">
                {more.map((chart) => (
                  <ChartCard key={chart.key} chart={chart} {...chartProps} />
                ))}
              </div>
              <OtherLabels view={view} keys={moreLabels} />
            </section>
          )}
        </div>
      )}
    </>
  )
}

function SyncNotices({ profile }: { profile: OuraProfile }) {
  return (
    <>
      {profile.backfilledAt === null && (
        <p className="notice">
          Still bringing in your last year from Oura. Charts fill in as it arrives, usually within a
          few minutes of connecting.
        </p>
      )}
      {profile.missingCollections.length > 0 && (
        <p className="notice warn">
          Oura didn't share{' '}
          {profile.missingCollections.map((collection) => humanize(collection)).join(', ')}.{' '}
          <a href={connectUrl('oura')}>Reconnect and allow every permission</a>
        </p>
      )}
    </>
  )
}

const RING_HARDWARE: Record<string, string> = {
  gen1: 'Gen 1',
  gen2: 'Gen 2',
  gen2m: 'Gen 2M',
  gen3: 'Gen 3',
  gen4: 'Ring 4',
  or5: 'Ring 5',
}

function ProfileCard({ profile }: { profile: OuraProfile }) {
  const person = as<PersonalInfo>(profile.personalInfo)
  const battery = as<BatterySample>(profile.battery)
  const facts: [string, string | null | undefined][] = [
    ['Oura account', person?.email],
    ['Age', person?.age != null ? `${person.age}` : null],
    ['Height', person?.height != null ? `${person.height.toFixed(2)} m` : null],
    ['Weight', person?.weight != null ? `${formatDecimal(person.weight)} kg` : null],
    ['Biological sex', person?.biological_sex && humanize(person.biological_sex)],
    ...profile.rings.map((document): [string, string] => {
      const ring = as<RingConfiguration>(document)
      const details = [
        ring?.hardware_type && (RING_HARDWARE[ring.hardware_type] ?? ring.hardware_type),
        ring?.design && humanize(ring.design),
        ring?.color && humanize(ring.color).toLowerCase(),
        ring?.size != null && `size ${ring.size}`,
        ring?.firmware_version && `firmware ${ring.firmware_version}`,
        ring?.set_up_at && `set up ${formatShortDay(ring.set_up_at.slice(0, 10))}`,
      ]
      return ['Ring', details.filter(Boolean).join(', ')]
    }),
    [
      'Battery',
      battery &&
        `${battery.level}%${battery.charging ? ', charging' : ''}` +
          ` as of ${formatLocalTime(battery.timestamp)}`,
    ],
  ]
  const shown = facts.filter(([, value]) => value)
  if (shown.length === 0) return null
  return (
    <section className="card">
      <h2>Account and ring</h2>
      <dl className="facts">
        {shown.map(([term, value], index) => (
          <div key={index} className="fact">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The value a chart reads out, and the day it's from, which links to that day. */
function Readout({ text, days, index }: { text: string; days: string[]; index: number }) {
  if (index < 0) return <p className="readout muted">No data in this period</p>
  return (
    <p className="readout">
      <strong>{text}</strong>{' '}
      <Link to={`/oura/${days[index]}`} className="muted">
        {describeDay(days, index)}
      </Link>
    </p>
  )
}

function ChartCard({ chart, ...props }: { chart: ChartSpec } & ChartProps) {
  switch (chart.kind) {
    case 'line':
      return <LineCard chart={chart} {...props} />
    case 'stack':
      return <StackCard chart={chart} {...props} />
    case 'heatmap':
      return <HeatmapCard chart={chart} {...props} />
    case 'strip':
      return <StripCard chart={chart} {...props} />
  }
}

const nulls = (length: number) => Array<null>(length).fill(null)

function LineCard({
  chart,
  view,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: { chart: LineSpec } & ChartProps) {
  const { key, band, unit, label } = chart
  const points = useMemo<TrendPoint[]>(() => {
    const values = (key && view.series[key]) || nulls(view.days.length)
    const lows = band && view.series[band.low]
    const highs = band && view.series[band.high]
    return view.days.map((day, index) => {
      const low = lows?.[index] ?? null
      const high = highs?.[index] ?? null
      return {
        day,
        value: values[index] ?? null,
        range: low !== null && high !== null ? { low, high } : null,
        flagged: false,
      }
    })
  }, [view, key, band])
  const latest = points.findLastIndex((point) => point.value !== null || point.range !== null)
  const index = activeIndex ?? latest
  const point = points[index]
  const text = !point
    ? ''
    : point.value !== null
      ? unit.format(point.value)
      : point.range
        ? `${unit.format(point.range.low)} – ${unit.format(point.range.high)}`
        : '–'

  return (
    <section className="card chart-card">
      <header className="chart-card-header">
        <h3>{label}</h3>
        <Readout text={text} days={view.days} index={index} />
      </header>
      {key && band && (
        <Legend
          items={[
            { label: 'Average', color: 'var(--chart-line)' },
            { label: band.label, color: 'var(--chart-band)' },
          ]}
        />
      )}
      <TrendChart
        label={`${label} over the last ${view.days.length} days`}
        points={points}
        height={96}
        formatTick={unit.tick}
        tickSteps={unit.steps}
        connectGaps={chart.sparse}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
      />
    </section>
  )
}

function StackCard({
  chart,
  view,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: { chart: StackSpec } & ChartProps) {
  const layers = useMemo(
    () =>
      chart.layers.map(({ key, label, color }) => ({
        label,
        color,
        values: view.series[key] ?? nulls(view.days.length),
      })),
    [chart, view],
  )
  const latest = view.days.findLastIndex((_, i) => layers.some((layer) => layer.values[i] != null))
  const index = activeIndex ?? latest
  const total = layers.reduce((sum, layer) => sum + (layer.values[index] ?? 0), 0)
  // Top layer first, as the bars read from the top.
  const legend = [...layers].reverse().map(({ label, color, values }) => ({
    label: index >= 0 && values[index] != null ? `${label} ${chart.unit.format(values[index] ?? 0)}` : label,
    color,
  }))
  return (
    <section className="card chart-card">
      <header className="chart-card-header">
        <h3>{chart.label}</h3>
        <Readout text={chart.unit.format(total)} days={view.days} index={index} />
      </header>
      <Legend items={legend} />
      <StackedBars
        label={`${chart.label} over the last ${view.days.length} days`}
        days={view.days}
        layers={layers}
        height={96}
        formatTick={chart.unit.tick}
        tickSteps={chart.unit.steps}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
      />
    </section>
  )
}

function HeatmapCard({
  chart,
  view,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: { chart: HeatmapSpec } & ChartProps) {
  const rows = useMemo(
    () =>
      chart.rows.map(({ key, label }) => ({
        label,
        values: view.series[key] ?? nulls(view.days.length),
      })),
    [chart, view],
  )
  const latest = view.days.findLastIndex((_, i) => rows.some((row) => row.values[i] != null))
  const index = activeIndex ?? latest
  return (
    <section className="card chart-card wide">
      <header className="chart-card-header">
        <h3>{chart.label}</h3>
        <Readout text="" days={view.days} index={index} />
      </header>
      <Legend items={CONTRIBUTOR_LEGEND} />
      <Heatmap
        label={`${chart.label} over the last ${view.days.length} days, from 1 to 100`}
        days={view.days}
        rows={rows}
        colorOf={contributorColor}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
      />
      {index >= 0 && (
        <p className="small muted contributor-values">
          {rows
            .filter((row) => row.values[index] != null)
            .map((row) => `${row.label} ${row.values[index]}`)
            .join(' · ')}
        </p>
      )}
    </section>
  )
}

function StripCard({
  chart,
  view,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: { chart: StripSpec } & ChartProps) {
  const rows = useMemo(
    () => [{ label: '', values: view.labels[chart.key] ?? nulls(view.days.length) }],
    [chart, view],
  )
  const colorOf = useCallback(
    (value: string) =>
      chart.categories.find((category) => category.value === value)?.color ?? 'var(--diverge-neutral)',
    [chart],
  )
  const values = rows[0]?.values ?? []
  const latest = values.findLastIndex((value) => value !== null)
  const index = activeIndex ?? latest
  const value = values[index]
  const text = value ? (chart.categories.find((c) => c.value === value)?.label ?? humanize(value)) : '–'
  return (
    <section className="card chart-card">
      <header className="chart-card-header">
        <h3>{chart.label}</h3>
        <Readout text={text} days={view.days} index={index} />
      </header>
      <Legend items={chart.categories} />
      <Heatmap
        label={`${chart.label} over the last ${view.days.length} days`}
        days={view.days}
        rows={rows}
        colorOf={colorOf}
        rowHeight={22}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
      />
    </section>
  )
}

const INTENSITIES = [
  { value: 'easy', label: 'Easy', color: 'var(--intensity-easy)' },
  { value: 'moderate', label: 'Moderate', color: 'var(--intensity-moderate)' },
  { value: 'hard', label: 'Hard', color: 'var(--intensity-hard)' },
] as const

function Workouts({ view, activeIndex, onActiveIndexChange, onSelect }: ChartProps) {
  const workouts = view.lists.workout as Workout[]
  const layers = useMemo(() => {
    const indexOf = new Map(view.days.map((day, index) => [day, index]))
    return INTENSITIES.map(({ value, label, color }) => {
      const values = nulls(view.days.length) as (number | null)[]
      for (const workout of workouts) {
        const index = indexOf.get(workout.day)
        if (index === undefined || workout.intensity !== value) continue
        values[index] = (values[index] ?? 0) + secondsBetween(workout.start_datetime, workout.end_datetime)
      }
      return { label, color, values }
    })
  }, [view, workouts])
  if (workouts.length === 0) return null

  const latest = view.days.findLastIndex((_, i) => layers.some((layer) => layer.values[i] != null))
  const index = activeIndex ?? latest
  const total = layers.reduce((sum, layer) => sum + (layer.values[index] ?? 0), 0)
  return (
    <section className="oura-section">
      <h2>Workouts</h2>
      <div className="chart-grid">
        <section className="card chart-card wide">
          <header className="chart-card-header">
            <h3>Workout time by intensity</h3>
            <Readout text={formatDuration(total)} days={view.days} index={index} />
          </header>
          <Legend items={[...INTENSITIES].reverse()} />
          <StackedBars
            label={`Workout time over the last ${view.days.length} days`}
            days={view.days}
            layers={layers}
            height={96}
            formatTick={UNITS.duration.tick}
            tickSteps={UNITS.duration.steps}
            activeIndex={activeIndex}
            onActiveIndexChange={onActiveIndexChange}
            onSelect={onSelect}
          />
        </section>
      </div>
      <WorkoutTable workouts={workouts} />
    </section>
  )
}

/** Every workout in the period, newest first. Memoized: the crosshair doesn't change it. */
const WorkoutTable = memo(function WorkoutTable({ workouts }: { workouts: Workout[] }) {
  return (
      <details className="card">
        <summary>
          {workouts.length} {workouts.length === 1 ? 'workout' : 'workouts'}
        </summary>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Activity</th>
                <th>Time</th>
                <th>Duration</th>
                <th>Intensity</th>
                <th>Calories</th>
                <th>Distance</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...workouts].reverse().map((workout) => (
                <tr key={workout.id}>
                  <td>
                    <Link to={`/oura/${workout.day}`}>{formatShortDay(workout.day)}</Link>
                  </td>
                  <td>
                    {humanize(workout.activity)}
                    {workout.label && <span className="muted"> · {workout.label}</span>}
                  </td>
                  <td>{formatLocalTime(workout.start_datetime)}</td>
                  <td>{formatDuration(secondsBetween(workout.start_datetime, workout.end_datetime))}</td>
                  <td>{humanize(workout.intensity)}</td>
                  <td>{workout.calories != null ? `${formatCount(workout.calories)} kcal` : '–'}</td>
                  <td>{workout.distance != null ? UNITS.kilometers.format(workout.distance) : '–'}</td>
                  <td>{humanize(workout.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
  )
})

/**
 * Sessions, tags, and rest mode: things that happened, listed rather than charted. Memoized,
 * like WorkoutTable: hundreds of rows needn't re-render each time the crosshair moves.
 */
const ListSections = memo(function ListSections({ view }: { view: View }) {
  const sessions = view.lists.session as Session[]
  const enhancedTags = view.lists.enhanced_tag as EnhancedTag[]
  const tags = view.lists.tag as Tag[]
  const restModes = view.lists.rest_mode_period as RestModePeriod[]
  if (sessions.length + enhancedTags.length + tags.length + restModes.length === 0) return null
  return (
    <section className="oura-section">
      <h2>Sessions, tags, and rest mode</h2>
      {sessions.length > 0 && (
        <details className="card">
          <summary>
            {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
          </summary>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Type</th>
                  <th>Time</th>
                  <th>Duration</th>
                  <th>Mood</th>
                </tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((session) => (
                  <tr key={session.id}>
                    <td>
                      <Link to={`/oura/${session.day}`}>{formatShortDay(session.day)}</Link>
                    </td>
                    <td>{humanize(session.type)}</td>
                    <td>{formatLocalTime(session.start_datetime)}</td>
                    <td>{formatDuration(secondsBetween(session.start_datetime, session.end_datetime))}</td>
                    <td>{session.mood ? humanize(session.mood) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {enhancedTags.length + tags.length > 0 && (
        <details className="card">
          <summary>
            {enhancedTags.length + tags.length} {enhancedTags.length + tags.length === 1 ? 'tag' : 'tags'}
          </summary>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Tag</th>
                  <th>Time</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {[...enhancedTags].reverse().map((tag) => (
                  <tr key={tag.id}>
                    <td>
                      <Link to={`/oura/${tag.start_day}`}>{formatShortDay(tag.start_day)}</Link>
                    </td>
                    <td>{tagName(tag)}</td>
                    <td>
                      {formatLocalTime(tag.start_time)}
                      {tag.end_time && ` – ${formatLocalTime(tag.end_time)}`}
                    </td>
                    <td>{tag.comment ?? ''}</td>
                  </tr>
                ))}
                {[...tags].reverse().map((tag) => (
                  <tr key={tag.id}>
                    <td>
                      <Link to={`/oura/${tag.day}`}>{formatShortDay(tag.day)}</Link>
                    </td>
                    <td>{tag.tags.map(tagCodeName).join(', ')}</td>
                    <td>{formatLocalTime(tag.timestamp)}</td>
                    <td>{tag.text ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {restModes.length > 0 && (
        <details className="card">
          <summary>
            {restModes.length} rest mode {restModes.length === 1 ? 'period' : 'periods'}
          </summary>
          <ul className="list">
            {[...restModes].reverse().map((period) => (
              <li key={period.id}>
                {formatShortDay(period.start_day)}
                {period.end_day ? ` to ${formatShortDay(period.end_day)}` : ', ongoing'}
                {period.episodes.length > 0 &&
                  `: ${period.episodes.flatMap((episode) => episode.tags).map(tagCodeName).join(', ')}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
})

/** Enumerated values no chart shows, with their latest value. */
const OtherLabels = memo(function OtherLabels({ view, keys }: { view: View; keys: string[] }) {
  const latest = keys.flatMap((key) => {
    const values = view.labels[key] ?? []
    const index = values.findLastIndex((value) => value !== null)
    const value = values[index]
    return value ? [{ key, value, index }] : []
  })
  if (latest.length === 0) return null
  return (
    <section className="card">
      <h3 className="card-title">Other values</h3>
      <dl className="facts">
        {latest.map(({ key, value, index }) => (
          <div key={key} className="fact">
            <dt>{labelForKey(key)}</dt>
            <dd>
              {humanize(value)} <span className="muted">· {describeDay(view.days, index)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
})
