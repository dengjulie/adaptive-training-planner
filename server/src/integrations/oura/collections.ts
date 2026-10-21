/**
 * Every collection under /v2/usercollection in Oura's API (OpenAPI spec 1.41). The app stores all
 * of them (README, "Data handling").
 */
export const OURA_COLLECTIONS = [
  'daily_readiness',
  'daily_sleep',
  'sleep',
  'sleep_time',
  'daily_activity',
  'daily_spo2',
  'daily_stress',
  'daily_resilience',
  'daily_cardiovascular_age',
  'vO2_max',
  'workout',
  'session',
  'enhanced_tag',
  'tag',
  'rest_mode_period',
  'heartrate',
  'ring_battery_level',
  'ring_configuration',
  'personal_info',
] as const

export type OuraCollection = (typeof OURA_COLLECTIONS)[number]

export type CollectionShape =
  /** Documents queried by start_date and end_date, each belonging to the day in `dayField`. */
  | { kind: 'documents'; dayField: 'day' | 'start_day' }
  /** Samples queried by start_datetime and end_datetime, stored one record per local day. */
  | { kind: 'samples' }
  /** Documents without a day, all of them returned every time. */
  | { kind: 'undated' }
  /** One document, not wrapped in a page. */
  | { kind: 'single' }

const BY_DAY: CollectionShape = { kind: 'documents', dayField: 'day' }
const BY_START_DAY: CollectionShape = { kind: 'documents', dayField: 'start_day' }

export const COLLECTION_SHAPES: Record<OuraCollection, CollectionShape> = {
  daily_readiness: BY_DAY,
  daily_sleep: BY_DAY,
  sleep: BY_DAY,
  sleep_time: BY_DAY,
  daily_activity: BY_DAY,
  daily_spo2: BY_DAY,
  daily_stress: BY_DAY,
  daily_resilience: BY_DAY,
  daily_cardiovascular_age: BY_DAY,
  vO2_max: BY_DAY,
  workout: BY_DAY,
  session: BY_DAY,
  enhanced_tag: BY_START_DAY,
  tag: BY_DAY,
  rest_mode_period: BY_START_DAY,
  heartrate: { kind: 'samples' },
  ring_battery_level: { kind: 'samples' },
  ring_configuration: { kind: 'undated' },
  personal_info: { kind: 'single' },
}

/**
 * The readiness rules can't run without these, so a missing scope here means the user must
 * reconnect. Without any other collection the app still works and that data is left out.
 */
export const REQUIRED_COLLECTIONS: readonly OuraCollection[] = ['daily_readiness', 'sleep']
