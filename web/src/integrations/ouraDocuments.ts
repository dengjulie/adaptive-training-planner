// Shapes of the Oura API documents the app shows, from Oura's OpenAPI spec 1.41. The server
// stores documents as Oura sends them, so treat every field as possibly missing.
import { humanize } from '../format.ts'
import type { OuraDocument } from './oura.ts'

/** Values recorded every `interval` seconds from `timestamp`. */
export type Sample = { interval: number; items: (number | null)[]; timestamp: string }

export type Contributors = Record<string, number | null>

export type DailyReadiness = {
  score?: number | null
  temperature_deviation?: number | null
  temperature_trend_deviation?: number | null
  contributors?: Contributors
}

export type DailySleep = { score?: number | null; contributors?: Contributors }

export type SleepPeriod = {
  id: string
  type?: 'deleted' | 'sleep' | 'long_sleep' | 'late_nap' | 'rest' | null
  bedtime_start: string
  bedtime_end: string
  total_sleep_duration?: number | null
  time_in_bed?: number
  deep_sleep_duration?: number | null
  light_sleep_duration?: number | null
  rem_sleep_duration?: number | null
  awake_time?: number | null
  efficiency?: number | null
  latency?: number | null
  average_heart_rate?: number | null
  lowest_heart_rate?: number | null
  average_hrv?: number | null
  average_breath?: number | null
  restless_periods?: number | null
  readiness_score_delta?: number | null
  sleep_score_delta?: number | null
  low_battery_alert?: boolean
  sleep_algorithm_version?: string | null
  sleep_analysis_reason?: string | null
  heart_rate?: Sample | null
  hrv?: Sample | null
  /** One character per 30 seconds: 1 no motion, 2 restless, 3 tossing and turning, 4 active. */
  movement_30_sec?: string | null
  /** One character per 5 minutes: 1 deep, 2 light, 3 REM, 4 awake. */
  sleep_phase_5_min?: string | null
  /** As sleep_phase_5_min, every 30 seconds. */
  sleep_phase_30_sec?: string | null
}

export type DailyActivity = {
  /** When the activity day starts, around 4 AM local time. */
  timestamp?: string
  score?: number | null
  steps?: number
  active_calories?: number
  total_calories?: number
  target_calories?: number
  equivalent_walking_distance?: number
  target_meters?: number
  meters_to_target?: number
  high_activity_time?: number
  medium_activity_time?: number
  low_activity_time?: number
  sedentary_time?: number
  resting_time?: number
  non_wear_time?: number
  high_activity_met_minutes?: number
  medium_activity_met_minutes?: number
  low_activity_met_minutes?: number
  sedentary_met_minutes?: number
  average_met_minutes?: number
  inactivity_alerts?: number
  /** One character per 5 minutes: 0 non-wear, 1 rest, 2 inactive, 3 low, 4 medium, 5 high. */
  class_5_min?: string | null
  met?: Sample
  contributors?: Contributors
}

export type DailySpO2 = {
  spo2_percentage?: { average: number } | null
  breathing_disturbance_index?: number | null
}

export type DailyStress = {
  stress_high?: number | null
  recovery_high?: number | null
  day_summary?: 'restored' | 'normal' | 'stressful' | null
}

export type DailyResilience = {
  level?: 'limited' | 'adequate' | 'solid' | 'strong' | 'exceptional'
  contributors?: { sleep_recovery: number; daytime_recovery: number; stress: number }
}

export type DailyCardiovascularAge = {
  vascular_age?: number | null
  pulse_wave_velocity?: number | null
}

export type VO2Max = { vo2_max?: number; timestamp?: string }

export type SleepTime = {
  optimal_bedtime?: { day_tz: number; start_offset: number; end_offset: number } | null
  recommendation?: string | null
  status?: string | null
}

export type Workout = {
  id: string
  activity: string
  calories?: number | null
  day: string
  distance?: number | null
  start_datetime: string
  end_datetime: string
  intensity: 'easy' | 'moderate' | 'hard'
  label?: string | null
  source: string
}

export type Session = {
  id: string
  day: string
  type: string
  mood?: string | null
  start_datetime: string
  end_datetime: string
  heart_rate?: Sample | null
  heart_rate_variability?: Sample | null
  motion_count?: Sample | null
}

export type EnhancedTag = {
  id: string
  tag_type_code?: string | null
  custom_name?: string | null
  start_time: string
  end_time?: string | null
  start_day: string
  end_day?: string | null
  comment?: string | null
}

export type Tag = { id: string; day: string; text?: string | null; timestamp: string; tags: string[] }

export type RestModePeriod = {
  id: string
  start_day: string
  end_day?: string | null
  start_time?: string | null
  end_time?: string | null
  episodes: { tags: string[]; timestamp: string }[]
}

export type HeartRateSample = { timestamp: string; bpm: number; source: string }

export type BatterySample = {
  timestamp: string
  level: number
  charging?: boolean | null
  in_charger?: boolean | null
}

/** Records of pure time series are stored as one document per day holding the samples. */
export type SampleDay<T> = { samples: T[] }

export type PersonalInfo = {
  age?: number | null
  weight?: number | null
  height?: number | null
  biological_sex?: string | null
  email?: string | null
}

export type RingConfiguration = {
  id: string
  color?: string | null
  design?: string | null
  firmware_version?: string | null
  hardware_type?: string | null
  set_up_at?: string | null
  size?: number | null
}

/** Narrows a stored document to its shape. The server keeps documents as Oura sent them. */
export const as = <T>(document: OuraDocument | null | undefined) => document as T | undefined

/** Seconds between two Oura timestamps, e.g. a workout's length. */
export const secondsBetween = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / 1000

/** An Oura tag code as words: "tag_generic_alcohol" reads "Alcohol". */
export const tagCodeName = (code: string) => humanize(code.replace(/^tag_(generic_)?/, ''))

/** What a tag says: its custom name, its type, or "Note". */
export const tagName = (tag: EnhancedTag) =>
  tag.custom_name ?? (tag.tag_type_code ? tagCodeName(tag.tag_type_code) : 'Note')
