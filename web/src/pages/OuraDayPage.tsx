import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useMe } from '../api.ts'
import { Legend } from '../components/ChartParts.tsx'
import { ErrorMessage } from '../components/ErrorMessage.tsx'
import { StateChart, TimeChart } from '../components/TimeCharts.tsx'
import { samplePoints, startOfDay, stateRuns, type TimedValue } from '../components/time.ts'
import {
  formatClock,
  formatCount,
  formatDecimal,
  formatDuration,
  formatLocalTime,
  humanize,
} from '../format.ts'
import {
  formatLongDay,
  formatShortDay,
  useOuraDay,
  type OuraDocument,
} from '../integrations/oura.ts'
import {
  as,
  tagName,
  type BatterySample,
  type Contributors,
  type DailyActivity,
  type DailyCardiovascularAge,
  type DailyReadiness,
  type DailyResilience,
  type DailySleep,
  type DailySpO2,
  type DailyStress,
  type EnhancedTag,
  type HeartRateSample,
  type RestModePeriod,
  type SampleDay,
  type Session,
  type SleepPeriod,
  type SleepTime,
  type Tag,
  type VO2Max,
  type Workout,
  secondsBetween,
  tagCodeName,
} from '../integrations/ouraDocuments.ts'
import { UNITS } from '../integrations/ouraMetrics.ts'

const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

const SLEEP_STAGES = [
  { value: '4', label: 'Awake', color: 'var(--sleep-awake)' },
  { value: '3', label: 'REM', color: 'var(--sleep-rem)' },
  { value: '2', label: 'Light', color: 'var(--sleep-light)' },
  { value: '1', label: 'Deep', color: 'var(--sleep-deep)' },
]

// No motion is most of a night; leaving it undrawn makes the movement stand out.
const MOVEMENT = [
  { value: '2', label: 'Restless', color: 'var(--activity-low)' },
  { value: '3', label: 'Tossing and turning', color: 'var(--activity-medium)' },
  { value: '4', label: 'Active', color: 'var(--activity-high)' },
]

const ACTIVITY_LEVELS = [
  { value: '0', label: 'Not worn', color: 'var(--activity-nonwear)' },
  { value: '1', label: 'Rest', color: 'var(--activity-rest)' },
  { value: '2', label: 'Inactive', color: 'var(--activity-inactive)' },
  { value: '3', label: 'Low', color: 'var(--activity-low)' },
  { value: '4', label: 'Medium', color: 'var(--activity-medium)' },
  { value: '5', label: 'High', color: 'var(--activity-high)' },
]

const CONTRIBUTOR_LABELS: Record<string, string> = {
  activity_balance: 'Activity balance',
  body_temperature: 'Body temperature',
  hrv_balance: 'HRV balance',
  previous_day_activity: 'Previous day activity',
  previous_night: 'Previous night',
  recovery_index: 'Recovery index',
  resting_heart_rate: 'Resting heart rate',
  sleep_balance: 'Sleep balance',
  sleep_regularity: 'Sleep regularity',
  deep_sleep: 'Deep sleep',
  efficiency: 'Efficiency',
  latency: 'Latency',
  rem_sleep: 'REM sleep',
  restfulness: 'Restfulness',
  timing: 'Timing',
  total_sleep: 'Total sleep',
  meet_daily_targets: 'Meet daily targets',
  move_every_hour: 'Move every hour',
  recovery_time: 'Recovery time',
  stay_active: 'Stay active',
  training_frequency: 'Training frequency',
  training_volume: 'Training volume',
  sleep_recovery: 'Sleep recovery',
  daytime_recovery: 'Daytime recovery',
  stress: 'Stress',
}

const SLEEP_TITLES: Record<string, string> = {
  long_sleep: 'Night',
  sleep: 'Sleep',
  late_nap: 'Nap',
  rest: 'Rest',
}

type Fact = [term: string, value: ReactNode | null | undefined]

/** Label-value pairs, skipping the ones Oura didn't send. */
function Facts({ items }: { items: Fact[] }) {
  const shown = items.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (shown.length === 0) return null
  return (
    <dl className="facts">
      {shown.map(([term, value]) => (
        <div key={term} className="fact">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const maybe = <T,>(value: T | null | undefined, format: (value: T) => string) =>
  value === null || value === undefined ? null : format(value)

const CONTRIBUTOR_ORDER = Object.keys(CONTRIBUTOR_LABELS)

/** Contributor scores (1 to 100) as meters, in Oura's order (stored JSON keeps none). */
function ContributorBars({ contributors }: { contributors?: Contributors }) {
  const rank = (field: string) => {
    const index = CONTRIBUTOR_ORDER.indexOf(field)
    return index === -1 ? CONTRIBUTOR_ORDER.length : index
  }
  const entries = Object.entries(contributors ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort(([a], [b]) => rank(a) - rank(b))
  if (entries.length === 0) return null
  return (
    <ul className="meters">
      {entries.map(([field, value]) => (
        <li key={field}>
          <span>{CONTRIBUTOR_LABELS[field] ?? humanize(field)}</span>
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
          </span>
          <span className="meter-value">{Math.round(value)}</span>
        </li>
      ))}
    </ul>
  )
}

function ScoreCard({
  title,
  value,
  contributors,
  children,
}: {
  title: string
  /** The score, or for resilience its level. */
  value?: ReactNode
  contributors?: Contributors
  children?: ReactNode
}) {
  return (
    <section className="card">
      <h3 className="card-title">{title}</h3>
      <p className="stat-value">{value ?? '–'}</p>
      <ContributorBars contributors={contributors} />
      {children}
    </section>
  )
}

export function OuraDayPage() {
  const { day = '' } = useParams()
  const { data: me } = useMe()
  const timeZone = me?.user.timezone ?? 'UTC'
  const valid = ISO_DAY.test(day) && !Number.isNaN(Date.parse(day))
  const query = useOuraDay(day, { enabled: valid })

  const header = (
    <>
      <p className="small">
        <Link to="/oura">Oura data</Link>
      </p>
      <div className="day-header">
        <h1>{valid ? formatLongDay(day) : 'Day not found'}</h1>
        {valid && (
          <nav className="actions" aria-label="Other days">
            <Link className="button subtle" to={`/oura/${shiftDay(day, -1)}`}>
              Previous day
            </Link>
            <Link className="button subtle" to={`/oura/${shiftDay(day, 1)}`}>
              Next day
            </Link>
          </nav>
        )}
      </div>
    </>
  )

  if (!valid) return header
  if (query.isPending) {
    return (
      <>
        {header}
        <p className="muted">Loading…</p>
      </>
    )
  }
  if (query.isError) {
    return (
      <>
        {header}
        <ErrorMessage error={query.error} />
      </>
    )
  }

  const { records } = query.data
  if (Object.keys(records).length === 0) {
    return (
      <>
        {header}
        <p className="muted">Nothing from Oura for this day. The app keeps the last year.</p>
      </>
    )
  }
  return (
    <>
      {header}
      <DayDetails day={day} records={records} timeZone={timeZone} />
    </>
  )
}

function DayDetails({
  day,
  records,
  timeZone,
}: {
  day: string
  records: Partial<Record<string, OuraDocument[]>>
  timeZone: string
}) {
  const first = <T,>(collection: string) => as<T>(records[collection]?.[0])
  const all = <T,>(collection: string) => (records[collection] ?? []) as T[]

  const readiness = first<DailyReadiness>('daily_readiness')
  const dailySleep = first<DailySleep>('daily_sleep')
  const activity = first<DailyActivity>('daily_activity')
  const spo2 = first<DailySpO2>('daily_spo2')
  const stress = first<DailyStress>('daily_stress')
  const resilience = first<DailyResilience>('daily_resilience')
  const cardio = first<DailyCardiovascularAge>('daily_cardiovascular_age')
  const vo2 = first<VO2Max>('vO2_max')
  const sleepTime = first<SleepTime>('sleep_time')
  const sleepPeriods = all<SleepPeriod>('sleep')
    .filter((period) => period.type !== 'deleted')
    .sort((a, b) => Date.parse(a.bedtime_start) - Date.parse(b.bedtime_start))
  const workouts = all<Workout>('workout')
  const sessions = all<Session>('session')
  const enhancedTags = all<EnhancedTag>('enhanced_tag')
  const tags = all<Tag>('tag')
  const restModes = all<RestModePeriod>('rest_mode_period')
  const heartRate = first<SampleDay<HeartRateSample>>('heartrate')?.samples ?? []
  const battery = first<SampleDay<BatterySample>>('ring_battery_level')?.samples ?? []
  const dayStart = startOfDay(day, timeZone)

  return (
    <>
      {(readiness || dailySleep || activity) && (
        <div className="cards three">
          {readiness && (
            <ScoreCard title="Readiness" value={readiness.score} contributors={readiness.contributors}>
              <Facts
                items={[
                  ['Temperature deviation', maybe(readiness.temperature_deviation, UNITS.celsius.format)],
                  ['Temperature trend', maybe(readiness.temperature_trend_deviation, UNITS.celsius.format)],
                ]}
              />
            </ScoreCard>
          )}
          {dailySleep && (
            <ScoreCard title="Sleep score" value={dailySleep.score} contributors={dailySleep.contributors} />
          )}
          {activity && (
            <ScoreCard title="Activity score" value={activity.score} contributors={activity.contributors} />
          )}
        </div>
      )}

      {sleepPeriods.length > 0 && (
        <section className="oura-section">
          <h2>Sleep</h2>
          <div className="cards">
            {sleepPeriods.map((period) => (
              <SleepCard key={period.id} period={period} timeZone={timeZone} />
            ))}
          </div>
          {sleepTime && (
            <section className="card">
              <h3 className="card-title">Bedtime guidance</h3>
              <Facts
                items={[
                  ['Recommendation', maybe(sleepTime.recommendation, humanize)],
                  ['Status', maybe(sleepTime.status, humanize)],
                  [
                    'Optimal bedtime',
                    sleepTime.optimal_bedtime &&
                      [
                        formatClock(sleepTime.optimal_bedtime.start_offset),
                        formatClock(sleepTime.optimal_bedtime.end_offset),
                      ].join(' – '),
                  ],
                ]}
              />
            </section>
          )}
        </section>
      )}

      {activity && <ActivityCard activity={activity} timeZone={timeZone} />}

      {heartRate.length > 0 && (
        <HeartRateCard
          samples={heartRate}
          dayStart={dayStart}
          workouts={workouts}
          sessions={sessions}
          timeZone={timeZone}
        />
      )}

      {workouts.length > 0 && (
        <section className="oura-section">
          <h2>Workouts</h2>
          <div className="cards">
            {workouts.map((workout) => (
              <section key={workout.id} className="card">
                <h3 className="card-title">
                  {humanize(workout.activity)}
                  {workout.label && <span className="muted"> · {workout.label}</span>}
                </h3>
                <Facts
                  items={[
                    [
                      'Time',
                      `${formatLocalTime(workout.start_datetime)} – ${formatLocalTime(workout.end_datetime)}`,
                    ],
                    ['Duration', formatDuration(secondsBetween(workout.start_datetime, workout.end_datetime))],
                    ['Intensity', humanize(workout.intensity)],
                    ['Calories', maybe(workout.calories, UNITS.kcal.format)],
                    ['Distance', maybe(workout.distance, UNITS.kilometers.format)],
                    ['Source', humanize(workout.source)],
                  ]}
                />
              </section>
            ))}
          </div>
        </section>
      )}

      {sessions.length > 0 && (
        <section className="oura-section">
          <h2>Sessions</h2>
          <div className="cards">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} timeZone={timeZone} />
            ))}
          </div>
        </section>
      )}

      {(spo2 || stress || resilience || cardio || vo2) && (
        <section className="oura-section">
          <h2>Body, stress, and resilience</h2>
          <div className="cards two">
            <section className="card">
              <h3 className="card-title">Body and stress</h3>
              <Facts
                items={[
                  ['Blood oxygen (SpO2)', maybe(spo2?.spo2_percentage?.average, UNITS.percent.format)],
                  ['Breathing disturbance index', maybe(spo2?.breathing_disturbance_index, formatCount)],
                  ['Cardiovascular age', maybe(cardio?.vascular_age, UNITS.years.format)],
                  ['Pulse wave velocity', maybe(cardio?.pulse_wave_velocity, UNITS.metersPerSecond.format)],
                  ['VO2 max', maybe(vo2?.vo2_max, UNITS.vo2.format)],
                  ['High stress', maybe(stress?.stress_high, formatDuration)],
                  ['High recovery', maybe(stress?.recovery_high, formatDuration)],
                  ['Day summary', maybe(stress?.day_summary, humanize)],
                ]}
              />
            </section>
            {resilience && (
              <ScoreCard
                title="Resilience"
                value={maybe(resilience.level, humanize)}
                contributors={resilience.contributors}
              />
            )}
          </div>
        </section>
      )}

      {(enhancedTags.length > 0 || tags.length > 0 || restModes.length > 0) && (
        <section className="oura-section">
          <h2>Tags and rest mode</h2>
          <section className="card">
            <ul className="list">
              {enhancedTags.map((tag) => (
                <li key={tag.id}>
                  <strong>{tagName(tag)}</strong> {formatLocalTime(tag.start_time)}
                  {tag.end_time && ` – ${formatLocalTime(tag.end_time)}`}
                  {tag.comment && <span className="muted"> · {tag.comment}</span>}
                </li>
              ))}
              {tags.map((tag) => (
                <li key={tag.id}>
                  <strong>{tag.tags.map(tagCodeName).join(', ') || 'Note'}</strong>{' '}
                  {formatLocalTime(tag.timestamp)}
                  {tag.text && <span className="muted"> · {tag.text}</span>}
                </li>
              ))}
              {restModes.map((period) => (
                <li key={period.id}>
                  <strong>Rest mode</strong> from{' '}
                  {period.start_time ? formatLocalTime(period.start_time) : formatShortDay(period.start_day)}
                  {period.end_day ? ` to ${formatShortDay(period.end_day)}` : ', ongoing'}
                  {period.episodes.length > 0 &&
                    `: ${period.episodes.flatMap((episode) => episode.tags).map(tagCodeName).join(', ')}`}
                </li>
              ))}
            </ul>
          </section>
        </section>
      )}

      {battery.length > 0 && <BatteryCard samples={battery} dayStart={dayStart} timeZone={timeZone} />}

      <details className="card raw-data">
        <summary>Everything Oura sent for this day</summary>
        {Object.entries(records).map(([collection, documents]) => (
          <div key={collection}>
            <h3>{humanize(collection)}</h3>
            <pre>{JSON.stringify(documents, null, 2)}</pre>
          </div>
        ))}
      </details>
    </>
  )
}

const timed = (period: { bedtime_start: string; bedtime_end: string }) => ({
  start: Date.parse(period.bedtime_start),
  end: Date.parse(period.bedtime_end),
})

function SleepCard({ period, timeZone }: { period: SleepPeriod; timeZone: string }) {
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const { start, end } = timed(period)
  const shared = { start, end, timeZone, activeTime, onActiveTimeChange: setActiveTime }
  const stages = useMemo(() => {
    if (period.sleep_phase_30_sec) return stateRuns(period.sleep_phase_30_sec, start, 30)
    if (period.sleep_phase_5_min) return stateRuns(period.sleep_phase_5_min, start, 300)
    return []
  }, [period, start])
  const movement = useMemo(
    () => (period.movement_30_sec ? stateRuns(period.movement_30_sec, start, 30) : []),
    [period, start],
  )
  const heartRate = useMemo(() => (period.heart_rate ? samplePoints(period.heart_rate) : []), [period])
  const hrv = useMemo(() => (period.hrv ? samplePoints(period.hrv) : []), [period])
  const title = SLEEP_TITLES[period.type ?? ''] ?? 'Sleep'

  return (
    <section className="card">
      <header className="chart-card-header">
        <h3>{title}</h3>
        <p className="muted small">
          {formatLocalTime(period.bedtime_start)} – {formatLocalTime(period.bedtime_end)}
        </p>
      </header>
      {stages.length > 0 && (
        <>
          <h4>Stages</h4>
          <StateChart label={`${title} sleep stages`} runs={stages} states={SLEEP_STAGES} {...shared} />
        </>
      )}
      {movement.length > 0 && (
        <>
          <h4>Movement</h4>
          <Legend items={MOVEMENT} />
          <StateChart label={`${title} movement`} runs={movement} states={MOVEMENT} strip {...shared} />
        </>
      )}
      {heartRate.length > 0 && (
        <>
          <h4>Heart rate</h4>
          <TimeChart
            label={`${title} heart rate`}
            points={heartRate}
            format={UNITS.bpm.format}
            tick={UNITS.bpm.tick}
            {...shared}
          />
        </>
      )}
      {hrv.length > 0 && (
        <>
          <h4>HRV</h4>
          <TimeChart
            label={`${title} HRV`}
            points={hrv}
            format={UNITS.ms.format}
            tick={UNITS.ms.tick}
            {...shared}
          />
        </>
      )}
      <Facts
        items={[
          ['Total sleep', maybe(period.total_sleep_duration, formatDuration)],
          ['Time in bed', maybe(period.time_in_bed, formatDuration)],
          ['Deep', maybe(period.deep_sleep_duration, formatDuration)],
          ['Light', maybe(period.light_sleep_duration, formatDuration)],
          ['REM', maybe(period.rem_sleep_duration, formatDuration)],
          ['Awake', maybe(period.awake_time, formatDuration)],
          ['Efficiency', maybe(period.efficiency, UNITS.percent.format)],
          ['Time to fall asleep', maybe(period.latency, formatDuration)],
          ['Average heart rate', maybe(period.average_heart_rate, UNITS.bpm.format)],
          ['Lowest heart rate', maybe(period.lowest_heart_rate, UNITS.bpm.format)],
          ['Average HRV', maybe(period.average_hrv, UNITS.ms.format)],
          ['Breathing rate', maybe(period.average_breath, UNITS.breaths.format)],
          ['Restless periods', maybe(period.restless_periods, formatCount)],
          ['Effect on readiness', maybe(period.readiness_score_delta, signed)],
          ['Effect on sleep score', maybe(period.sleep_score_delta, signed)],
          ['Low battery', period.low_battery_alert ? 'Yes' : null],
          ['Sleep algorithm', period.sleep_algorithm_version],
          ['Analyzed', maybe(period.sleep_analysis_reason, humanize)],
        ]}
      />
    </section>
  )
}

const signed = (value: number) => `${value > 0 ? '+' : ''}${formatDecimal(value)}`

function ActivityCard({ activity, timeZone }: { activity: DailyActivity; timeZone: string }) {
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const met = useMemo(() => (activity.met ? samplePoints(activity.met) : []), [activity])
  // Oura's activity day (from about 4 AM) starts where its MET samples do; 5-minute classes too.
  const start = met[0]?.time ?? (activity.timestamp ? Date.parse(activity.timestamp) : 0)
  const classes = useMemo(
    () => (activity.class_5_min && start ? stateRuns(activity.class_5_min, start, 300) : []),
    [activity, start],
  )
  const end = Math.max(start + DAY_MS, classes.at(-1)?.end ?? 0, met.at(-1)?.time ?? 0)
  const shared = { start, end, timeZone, activeTime, onActiveTimeChange: setActiveTime }

  return (
    <section className="oura-section">
      <h2>Activity</h2>
      <section className="card">
        {classes.length > 0 && (
          <>
            <h4>Activity level</h4>
            <Legend items={ACTIVITY_LEVELS} />
            <StateChart
              label="Activity level through the day"
              runs={classes}
              states={ACTIVITY_LEVELS}
              strip
              {...shared}
            />
          </>
        )}
        {met.length > 0 && (
          <>
            <h4>MET</h4>
            <TimeChart
              label="MET through the day"
              points={met}
              format={UNITS.met.format}
              tick={UNITS.met.tick}
              maxGapMs={5 * 60_000}
              {...shared}
            />
          </>
        )}
        <Facts
          items={[
            ['Steps', maybe(activity.steps, formatCount)],
            ['Active calories', maybe(activity.active_calories, UNITS.kcal.format)],
            ['Total calories', maybe(activity.total_calories, UNITS.kcal.format)],
            ['Active calorie target', maybe(activity.target_calories, UNITS.kcal.format)],
            [
              'Walking-equivalent distance',
              maybe(activity.equivalent_walking_distance, UNITS.kilometers.format),
            ],
            ['Distance target', maybe(activity.target_meters, UNITS.kilometers.format)],
            ['Distance left to target', maybe(activity.meters_to_target, UNITS.kilometers.format)],
            ['High activity', maybe(activity.high_activity_time, formatDuration)],
            ['Medium activity', maybe(activity.medium_activity_time, formatDuration)],
            ['Low activity', maybe(activity.low_activity_time, formatDuration)],
            ['Inactive', maybe(activity.sedentary_time, formatDuration)],
            ['Rest', maybe(activity.resting_time, formatDuration)],
            ['Not worn', maybe(activity.non_wear_time, formatDuration)],
            ['High activity MET minutes', maybe(activity.high_activity_met_minutes, formatCount)],
            ['Medium activity MET minutes', maybe(activity.medium_activity_met_minutes, formatCount)],
            ['Low activity MET minutes', maybe(activity.low_activity_met_minutes, formatCount)],
            ['Inactive MET minutes', maybe(activity.sedentary_met_minutes, formatCount)],
            ['Average MET', maybe(activity.average_met_minutes, UNITS.met.format)],
            ['Inactivity alerts', maybe(activity.inactivity_alerts, formatCount)],
          ]}
        />
      </section>
    </section>
  )
}

const HEART_RATE_SOURCES: Record<string, string> = {
  awake: 'Awake',
  rest: 'Resting',
  sleep: 'Asleep',
  workout: 'Workout',
  session: 'Session',
  live: 'Live',
}

function HeartRateCard({
  samples,
  dayStart,
  workouts,
  sessions,
  timeZone,
}: {
  samples: HeartRateSample[]
  dayStart: number
  workouts: Workout[]
  sessions: Session[]
  timeZone: string
}) {
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const points = useMemo<TimedValue[]>(
    () =>
      samples
        .map((sample) => ({ time: Date.parse(sample.timestamp), value: sample.bpm }))
        .sort((a, b) => a.time - b.time),
    [samples],
  )
  const spans = useMemo(
    () => [
      ...workouts.map((workout) => ({
        start: Date.parse(workout.start_datetime),
        end: Date.parse(workout.end_datetime),
        label: humanize(workout.activity),
      })),
      ...sessions.map((session) => ({
        start: Date.parse(session.start_datetime),
        end: Date.parse(session.end_datetime),
        label: humanize(session.type),
      })),
    ],
    [workouts, sessions],
  )
  const bySource = new Map<string, number[]>()
  for (const { source, bpm } of samples) bySource.set(source, [...(bySource.get(source) ?? []), bpm])
  return (
    <section className="oura-section">
      <h2>Heart rate</h2>
      <section className="card">
        <TimeChart
          label="Heart rate through the day"
          start={dayStart}
          end={dayStart + DAY_MS}
          timeZone={timeZone}
          activeTime={activeTime}
          onActiveTimeChange={setActiveTime}
          points={points}
          spans={spans}
          format={UNITS.bpm.format}
          tick={UNITS.bpm.tick}
          height={120}
        />
        <Facts
          items={[...bySource].map(([source, bpm]): Fact => {
            const average = bpm.reduce((sum, value) => sum + value, 0) / bpm.length
            return [
              HEART_RATE_SOURCES[source] ?? humanize(source),
              `${Math.min(...bpm)}–${Math.max(...bpm)} bpm, average ${Math.round(average)}` +
                ` (${bpm.length} readings)`,
            ]
          })}
        />
      </section>
    </section>
  )
}

function SessionCard({ session, timeZone }: { session: Session; timeZone: string }) {
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const start = Date.parse(session.start_datetime)
  const end = Date.parse(session.end_datetime)
  const shared = { start, end, timeZone, activeTime, onActiveTimeChange: setActiveTime }
  const series = [
    { label: 'Heart rate', sample: session.heart_rate, unit: UNITS.bpm },
    { label: 'HRV', sample: session.heart_rate_variability, unit: UNITS.ms },
    { label: 'Motion', sample: session.motion_count, unit: UNITS.count },
  ]
  return (
    <section className="card">
      <header className="chart-card-header">
        <h3>{humanize(session.type)}</h3>
        <p className="muted small">
          {formatLocalTime(session.start_datetime)} – {formatLocalTime(session.end_datetime)}
          {session.mood && ` · mood: ${humanize(session.mood).toLowerCase()}`}
        </p>
      </header>
      {series.map(({ label, sample, unit }) =>
        sample ? (
          <div key={label}>
            <h4>{label}</h4>
            <TimeChart
              label={`${humanize(session.type)} ${label.toLowerCase()}`}
              points={samplePoints(sample)}
              format={unit.format}
              tick={unit.tick}
              maxGapMs={sample.interval * 3000}
              height={72}
              {...shared}
            />
          </div>
        ) : null,
      )}
    </section>
  )
}

function BatteryCard({
  samples,
  dayStart,
  timeZone,
}: {
  samples: BatterySample[]
  dayStart: number
  timeZone: string
}) {
  const [activeTime, setActiveTime] = useState<number | null>(null)
  const points = useMemo<TimedValue[]>(
    () =>
      samples
        .map((sample) => ({ time: Date.parse(sample.timestamp), value: sample.level }))
        .sort((a, b) => a.time - b.time),
    [samples],
  )
  const charging = useMemo(
    () =>
      samples
        .filter((sample) => sample.charging)
        .map((sample) => {
          const time = Date.parse(sample.timestamp)
          return { start: time, end: time + 5 * 60_000, label: '' }
        }),
    [samples],
  )
  return (
    <section className="oura-section">
      <h2>Ring battery</h2>
      <section className="card">
        <TimeChart
          label="Ring battery level through the day"
          start={dayStart}
          end={dayStart + DAY_MS}
          timeZone={timeZone}
          activeTime={activeTime}
          onActiveTimeChange={setActiveTime}
          points={points}
          spans={charging}
          format={UNITS.percent.format}
          tick={UNITS.percent.tick}
          maxGapMs={2 * 60 * 60_000}
          height={72}
        />
        {charging.length > 0 && <p className="small muted">Shaded: charging</p>}
      </section>
    </section>
  )
}
