// How each value Oura sends is charted on the Oura data page. Values not listed here are still
// shown, under "More" (see otherSeries), so new fields from Oura appear without code changes.
import { TIME_STEPS } from '../components/charts.ts'
import { formatClock, formatCount, formatDecimal, formatDuration, humanize } from '../format.ts'

export type Unit = {
  /** A value as read out, e.g. "7h 32m" or "48 ms". */
  format: (value: number) => string
  /** A value-axis label. */
  tick: (value: number) => string
  /** Value-axis step sizes, when powers of ten aren't the round numbers (see valueTicks). */
  steps?: number[]
}

const suffixed = (suffix: string, format = formatCount) => (value: number) =>
  `${format(value)} ${suffix}`

export const UNITS = {
  plain: { format: formatDecimal, tick: formatDecimal },
  count: { format: formatCount, tick: formatCount },
  percent: { format: (value) => `${formatDecimal(value)}%`, tick: (value) => `${value}%` },
  ms: { format: suffixed('ms'), tick: formatCount },
  bpm: { format: suffixed('bpm'), tick: formatCount },
  kcal: { format: suffixed('kcal'), tick: formatCount },
  years: { format: suffixed('years'), tick: formatCount },
  breaths: { format: suffixed('/min', formatDecimal), tick: formatDecimal },
  metersPerSecond: { format: suffixed('m/s', formatDecimal), tick: formatDecimal },
  vo2: { format: suffixed('ml/kg/min'), tick: formatCount },
  met: { format: suffixed('MET', formatDecimal), tick: formatDecimal },
  metMinutes: { format: suffixed('MET-min'), tick: formatCount },
  /** Meters, read in kilometers. */
  kilometers: {
    format: (meters) => `${formatDecimal(meters / 1000)} km`,
    tick: (meters) => formatDecimal(meters / 1000),
    steps: [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000],
  },
  celsius: {
    format: (value) => `${value > 0 ? '+' : ''}${formatDecimal(value)} °C`,
    tick: formatDecimal,
  },
  /** Seconds. */
  duration: { format: formatDuration, tick: formatDuration, steps: TIME_STEPS },
  /** Seconds from midnight, negative for the evening before. */
  clock: { format: formatClock, tick: formatClock, steps: TIME_STEPS },
} satisfies Record<string, Unit>

export type LineSpec = {
  kind: 'line'
  label: string
  unit: Unit
  /** The series drawn as the line; without one, only the band is drawn. */
  key?: string
  /** Series shaded behind the line as a range. */
  band?: { low: string; high: string; label: string }
  /** Measured every few days rather than daily, so the line joins readings across empty days. */
  sparse?: boolean
}

export type StackSpec = {
  kind: 'stack'
  label: string
  unit: Unit
  /** Bottom layer first. */
  layers: { key: string; label: string; color: string }[]
}

export type HeatmapSpec = { kind: 'heatmap'; label: string; rows: { key: string; label: string }[] }

export type StripSpec = {
  kind: 'strip'
  label: string
  key: string
  /** In order, with the colors they're drawn in. */
  categories: { value: string; label: string; color: string }[]
}

export type ChartSpec = LineSpec | StackSpec | HeatmapSpec | StripSpec

const line = (key: string, label: string, unit: Unit, sparse = false): LineSpec => ({
  kind: 'line',
  key,
  label,
  unit,
  sparse,
})

const contributors = (collection: string, labels: Record<string, string>) =>
  Object.entries(labels).map(([field, label]) => ({
    key: `${collection}.contributors.${field}`,
    label,
  }))

/** Contributor scores run from 1 to 100; six bins of the sequential blue. */
export function contributorColor(value: number) {
  const bin = value < 50 ? 1 : value < 60 ? 2 : value < 70 ? 3 : value < 80 ? 4 : value < 90 ? 5 : 6
  return `var(--seq-${bin})`
}

export const CONTRIBUTOR_LEGEND = [
  { label: 'Under 50', color: 'var(--seq-1)' },
  { label: '50s', color: 'var(--seq-2)' },
  { label: '60s', color: 'var(--seq-3)' },
  { label: '70s', color: 'var(--seq-4)' },
  { label: '80s', color: 'var(--seq-5)' },
  { label: '90 and up', color: 'var(--seq-6)' },
]

/** Oura's activity levels, as labeled and colored in every chart that splits by them. */
const LEVELS = {
  nonWear: { label: 'Not worn', color: 'var(--activity-nonwear)' },
  rest: { label: 'Rest', color: 'var(--activity-rest)' },
  inactive: { label: 'Inactive', color: 'var(--activity-inactive)' },
  low: { label: 'Low', color: 'var(--activity-low)' },
  medium: { label: 'Medium', color: 'var(--activity-medium)' },
  high: { label: 'High', color: 'var(--activity-high)' },
}

export const SECTIONS: { title: string; charts: ChartSpec[] }[] = [
  {
    title: 'Scores',
    charts: [
      line('daily_readiness.score', 'Readiness', UNITS.count),
      line('daily_sleep.score', 'Sleep score', UNITS.count),
      line('daily_activity.score', 'Activity score', UNITS.count),
    ],
  },
  {
    title: 'Readiness',
    charts: [
      {
        kind: 'heatmap',
        label: 'Readiness contributors',
        rows: contributors('daily_readiness', {
          activity_balance: 'Activity balance',
          body_temperature: 'Body temperature',
          hrv_balance: 'HRV balance',
          previous_day_activity: 'Previous day activity',
          previous_night: 'Previous night',
          recovery_index: 'Recovery index',
          resting_heart_rate: 'Resting heart rate',
          sleep_balance: 'Sleep balance',
          sleep_regularity: 'Sleep regularity',
        }),
      },
      line('daily_readiness.temperature_deviation', 'Temperature deviation', UNITS.celsius),
      line('daily_readiness.temperature_trend_deviation', 'Temperature trend', UNITS.celsius),
    ],
  },
  {
    title: 'Sleep',
    charts: [
      {
        kind: 'stack',
        label: 'Sleep stages',
        unit: UNITS.duration,
        layers: [
          { key: 'sleep.deep_sleep_duration', label: 'Deep', color: 'var(--sleep-deep)' },
          { key: 'sleep.light_sleep_duration', label: 'Light', color: 'var(--sleep-light)' },
          { key: 'sleep.rem_sleep_duration', label: 'REM', color: 'var(--sleep-rem)' },
          { key: 'sleep.awake_time', label: 'Awake', color: 'var(--sleep-awake)' },
        ],
      },
      line('sleep.total_sleep_duration', 'Total sleep', UNITS.duration),
      line('sleep.time_in_bed', 'Time in bed', UNITS.duration),
      line('sleep.bedtime_start_offset', 'Bedtime', UNITS.clock),
      line('sleep.bedtime_end_offset', 'Wake time', UNITS.clock),
      {
        kind: 'line',
        label: 'Recommended bedtime',
        unit: UNITS.clock,
        band: {
          low: 'sleep_time.optimal_bedtime.start_offset',
          high: 'sleep_time.optimal_bedtime.end_offset',
          label: 'Window',
        },
      },
      line('sleep.efficiency', 'Sleep efficiency', UNITS.percent),
      line('sleep.latency', 'Time to fall asleep', UNITS.duration),
      line('sleep.average_heart_rate', 'Average heart rate asleep', UNITS.bpm),
      line('sleep.lowest_heart_rate', 'Lowest heart rate asleep', UNITS.bpm),
      line('sleep.average_hrv', 'Average HRV asleep', UNITS.ms),
      line('sleep.average_breath', 'Breathing rate', UNITS.breaths),
      line('sleep.restless_periods', 'Restless periods', UNITS.count),
      {
        kind: 'heatmap',
        label: 'Sleep contributors',
        rows: contributors('daily_sleep', {
          deep_sleep: 'Deep sleep',
          efficiency: 'Efficiency',
          latency: 'Latency',
          rem_sleep: 'REM sleep',
          restfulness: 'Restfulness',
          timing: 'Timing',
          total_sleep: 'Total sleep',
        }),
      },
    ],
  },
  {
    title: 'Activity',
    charts: [
      line('daily_activity.steps', 'Steps', UNITS.count),
      line('daily_activity.active_calories', 'Active calories', UNITS.kcal),
      line('daily_activity.total_calories', 'Total calories', UNITS.kcal),
      line('daily_activity.equivalent_walking_distance', 'Walking-equivalent distance', UNITS.kilometers),
      {
        kind: 'stack',
        label: 'Time by activity level',
        unit: UNITS.duration,
        layers: [
          { key: 'daily_activity.non_wear_time', ...LEVELS.nonWear },
          { key: 'daily_activity.resting_time', ...LEVELS.rest },
          { key: 'daily_activity.sedentary_time', ...LEVELS.inactive },
          { key: 'daily_activity.low_activity_time', ...LEVELS.low },
          { key: 'daily_activity.medium_activity_time', ...LEVELS.medium },
          { key: 'daily_activity.high_activity_time', ...LEVELS.high },
        ],
      },
      {
        kind: 'stack',
        label: 'MET minutes by activity level',
        unit: UNITS.metMinutes,
        layers: [
          { key: 'daily_activity.sedentary_met_minutes', ...LEVELS.inactive },
          { key: 'daily_activity.low_activity_met_minutes', ...LEVELS.low },
          { key: 'daily_activity.medium_activity_met_minutes', ...LEVELS.medium },
          { key: 'daily_activity.high_activity_met_minutes', ...LEVELS.high },
        ],
      },
      line('daily_activity.average_met_minutes', 'Average MET', UNITS.met),
      line('daily_activity.inactivity_alerts', 'Inactivity alerts', UNITS.count),
      line('daily_activity.target_calories', 'Active calorie target', UNITS.kcal),
      line('daily_activity.target_meters', 'Distance target', UNITS.kilometers),
      line('daily_activity.meters_to_target', 'Distance left to target', UNITS.kilometers),
      {
        kind: 'heatmap',
        label: 'Activity contributors',
        rows: contributors('daily_activity', {
          meet_daily_targets: 'Meet daily targets',
          move_every_hour: 'Move every hour',
          recovery_time: 'Recovery time',
          stay_active: 'Stay active',
          training_frequency: 'Training frequency',
          training_volume: 'Training volume',
        }),
      },
    ],
  },
  {
    title: 'Heart rate',
    charts: [
      {
        kind: 'line',
        key: 'heartrate.awake.avg',
        label: 'Daytime heart rate',
        unit: UNITS.bpm,
        band: { low: 'heartrate.awake.min', high: 'heartrate.awake.max', label: 'Lowest to highest' },
      },
      {
        kind: 'line',
        key: 'heartrate.workout.avg',
        label: 'Workout heart rate',
        unit: UNITS.bpm,
        band: { low: 'heartrate.workout.min', high: 'heartrate.workout.max', label: 'Lowest to highest' },
        sparse: true,
      },
    ],
  },
  {
    title: 'Stress and resilience',
    charts: [
      {
        kind: 'stack',
        label: 'Time in high stress and high recovery',
        unit: UNITS.duration,
        layers: [
          { key: 'daily_stress.stress_high', label: 'High stress', color: 'var(--diverge-warm)' },
          { key: 'daily_stress.recovery_high', label: 'High recovery', color: 'var(--diverge-cool)' },
        ],
      },
      {
        kind: 'strip',
        label: 'Day summary',
        key: 'daily_stress.day_summary',
        categories: [
          { value: 'stressful', label: 'Stressful', color: 'var(--diverge-warm)' },
          { value: 'normal', label: 'Normal', color: 'var(--diverge-neutral)' },
          { value: 'restored', label: 'Restored', color: 'var(--diverge-cool)' },
        ],
      },
      {
        kind: 'strip',
        label: 'Resilience',
        key: 'daily_resilience.level',
        categories: [
          { value: 'limited', label: 'Limited', color: 'var(--level-1)' },
          { value: 'adequate', label: 'Adequate', color: 'var(--level-2)' },
          { value: 'solid', label: 'Solid', color: 'var(--level-3)' },
          { value: 'strong', label: 'Strong', color: 'var(--level-4)' },
          { value: 'exceptional', label: 'Exceptional', color: 'var(--level-5)' },
        ],
      },
      {
        kind: 'heatmap',
        label: 'Resilience contributors',
        rows: contributors('daily_resilience', {
          sleep_recovery: 'Sleep recovery',
          daytime_recovery: 'Daytime recovery',
          stress: 'Stress',
        }),
      },
    ],
  },
  {
    title: 'Body',
    charts: [
      line('daily_spo2.spo2_percentage.average', 'Blood oxygen (SpO2)', UNITS.percent),
      line('daily_spo2.breathing_disturbance_index', 'Breathing disturbance index', UNITS.count),
      line('daily_cardiovascular_age.vascular_age', 'Cardiovascular age', UNITS.years, true),
      line(
        'daily_cardiovascular_age.pulse_wave_velocity',
        'Pulse wave velocity',
        UNITS.metersPerSecond,
        true,
      ),
      line('vO2_max.vo2_max', 'VO2 max', UNITS.vo2, true),
    ],
  },
]

/** Series keys the sections chart, lines, bands, and stacks alike. */
function chartedKeys() {
  const keys = new Set<string>()
  for (const { charts } of SECTIONS) {
    for (const chart of charts) {
      if (chart.kind === 'line') {
        if (chart.key) keys.add(chart.key)
        if (chart.band) keys.add(chart.band.low).add(chart.band.high)
      } else if (chart.kind === 'stack') chart.layers.forEach((layer) => keys.add(layer.key))
      else if (chart.kind === 'heatmap') chart.rows.forEach((row) => keys.add(row.key))
      else keys.add(chart.key)
    }
  }
  return keys
}

/** Bookkeeping rather than a measurement: a timezone offset in seconds. */
const NOT_SHOWN = new Set(['sleep_time.optimal_bedtime.day_tz'])

const COLLECTION_NAMES: Record<string, string> = {
  daily_readiness: 'Readiness',
  daily_sleep: 'Sleep',
  sleep: 'Sleep',
  sleep_time: 'Bedtime guidance',
  daily_activity: 'Activity',
  daily_spo2: 'SpO2',
  daily_stress: 'Stress',
  daily_resilience: 'Resilience',
  daily_cardiovascular_age: 'Cardiovascular age',
  vO2_max: 'VO2 max',
  heartrate: 'Heart rate',
}

/** "sleep.readiness_score_delta" reads "Sleep: Readiness score delta". */
export function labelForKey(key: string) {
  const [collection = '', ...path] = key.split('.')
  const name = COLLECTION_NAMES[collection] ?? humanize(collection)
  return `${name}: ${humanize(path.join(' '))}`
}

/** A unit guessed from a field's name, for values no section lists. */
function unitForKey(key: string): Unit {
  if (/(_duration|_time|latency|_high)$/.test(key)) return UNITS.duration
  if (/_offset$/.test(key)) return UNITS.clock
  if (/^heartrate\./.test(key)) return UNITS.bpm
  return UNITS.plain
}

/** Every series Oura sent that the sections don't chart, as plain line charts. */
export function otherSeries(seriesKeys: string[]): LineSpec[] {
  const charted = chartedKeys()
  return seriesKeys
    .filter((key) => !charted.has(key) && !NOT_SHOWN.has(key))
    .sort()
    .map((key) => line(key, labelForKey(key), unitForKey(key)))
}

/** Every enumerated value the sections don't chart, e.g. the sleep algorithm version. */
export function otherLabels(labelKeys: string[]) {
  const charted = chartedKeys()
  return labelKeys.filter((key) => !charted.has(key)).sort()
}
