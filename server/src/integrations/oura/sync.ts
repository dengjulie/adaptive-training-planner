import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Transaction } from '../../db/client.ts'
import { connections, ouraDaily, planAdjustments, type User } from '../../db/schema.ts'
import { markReauthRequired, updateConnectionMetadata } from '../../lib/connections.ts'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.ts'
import { MissingScopeError } from '../../lib/errors.ts'
import {
  getDocuments,
  getSamples,
  getSingleDocument,
  getUndatedDocuments,
  type OuraSample,
} from './client.ts'
import {
  COLLECTION_SHAPES,
  OURA_COLLECTIONS,
  REQUIRED_COLLECTIONS,
  type OuraCollection,
} from './collections.ts'
import { deleteRecordsBefore, replaceRecords, type NewRecord } from './records.ts'
import { nightlySleepByWakeDay } from './sleep.ts'

/**
 * Days of Oura data kept: a year, the user's choice (README, "Data handling"). The Oura API
 * agreement (June 2026, §3(m)) allows keeping data only as long as strictly necessary, and
 * PRIVACY.md promises this window, so change them together.
 */
export const OURA_RETENTION_DAYS = 365

/** Days a manual sync re-reads once the retention window has been backfilled. */
export const RECENT_SYNC_DAYS = 30

/** Collections fetched at the same time. A year-long backfill is dozens of requests. */
const CONCURRENCY = 4

export type OuraSyncResult = {
  /** Days with readiness or sleep values stored. */
  days: number
  /** Collections the user didn't grant the scope for. */
  missing: OuraCollection[]
  /** Collections that failed for another reason. The next sync tries them again. */
  failed: OuraCollection[]
}

/** One record per local day from `start` to `end`, holding that day's samples. */
export function samplesByDay(
  samples: OuraSample[],
  timeZone: string,
  start: IsoDate,
  end: IsoDate,
): NewRecord[] {
  const byDay = new Map<IsoDate, OuraSample[]>()
  for (const sample of samples) {
    // Sample timestamps are UTC instants, so the day comes from the user's timezone.
    const day = todayIn(timeZone, new Date(sample.timestamp))
    if (day < start || day > end) continue
    const daySamples = byDay.get(day)
    if (daySamples) daySamples.push(sample)
    else byDay.set(day, [sample])
  }
  return [...byDay].map(([day, daySamples]) => ({ recordId: day, day, data: { samples: daySamples } }))
}

/** A collection's records for the days `start` to `end`, or all of them if it has no days. */
async function fetchCollection(
  user: User,
  collection: OuraCollection,
  start: IsoDate,
  end: IsoDate,
): Promise<NewRecord[]> {
  const shape = COLLECTION_SHAPES[collection]
  switch (shape.kind) {
    case 'documents': {
      const documents = await getDocuments(user.id, collection, start, end)
      return documents.flatMap((data) => {
        const day = data[shape.dayField]
        return typeof day === 'string' && day >= start && day <= end
          ? [{ recordId: data.id, day, data }]
          : []
      })
    }
    case 'samples': {
      // Midnight UTC the day before reaches back past the start of `start` in every timezone.
      const from = new Date(`${addDays(start, -1)}T00:00:00Z`)
      const samples = await getSamples(user.id, collection, from, new Date())
      return samplesByDay(samples, user.timezone, start, end)
    }
    case 'undated': {
      const documents = await getUndatedDocuments(user.id, collection)
      return documents.map((data) => ({ recordId: data.id, day: null, data }))
    }
    case 'single': {
      const data = await getSingleDocument(user.id, collection)
      return [{ recordId: data.id, day: null, data }]
    }
  }
}

async function mapConcurrently<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>) {
  const results: R[] = []
  let next = 0
  async function work() {
    while (next < items.length) {
      const index = next++
      results[index] = await map(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work))
  return results
}

const DailyReadiness = z.object({ day: z.string(), score: z.number().nullish() })

const SleepPeriod = z.object({
  type: z.string().nullish(),
  bedtime_start: z.string(),
  bedtime_end: z.string(),
  total_sleep_duration: z.number().nullish(),
  average_hrv: z.number().nullish(),
  lowest_heart_rate: z.number().nullish(),
})

/** Readiness plus the night's HRV and resting heart rate per day, for the readiness rules. */
async function storeDailyValues(
  tx: Transaction,
  user: User,
  start: IsoDate,
  end: IsoDate,
  readinessRecords: NewRecord[],
  sleepRecords: NewRecord[],
) {
  const readiness = readinessRecords.map((record) => DailyReadiness.parse(record.data))
  const readinessByDay = new Map(readiness.map((entry) => [entry.day, entry.score ?? null]))
  const sleep = sleepRecords.map((record) => SleepPeriod.parse(record.data))
  const nights = nightlySleepByWakeDay(sleep, user.timezone)
  const days = [...new Set([...readinessByDay.keys(), ...nights.keys()])].filter(
    (day) => day >= start && day <= end,
  )

  if (days.length > 0) {
    await tx
      .insert(ouraDaily)
      .values(
        days.map((day) => ({
          userId: user.id,
          day,
          readinessScore: readinessByDay.get(day) ?? null,
          averageHrv: nights.get(day)?.average_hrv ?? null,
          restingHeartRate: nights.get(day)?.lowest_heart_rate ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [ouraDaily.userId, ouraDaily.day],
        set: {
          readinessScore: sql`excluded.readiness_score`,
          averageHrv: sql`excluded.average_hrv`,
          restingHeartRate: sql`excluded.resting_heart_rate`,
          updatedAt: sql`now()`,
        },
      })
  }
  return days.length
}

/**
 * Pulls the last `windowDays` days of every Oura collection (or of just `collections`) into
 * oura_records, derives oura_daily from them, then deletes data older than the retention window.
 * A collection whose scope the user didn't grant is skipped, unless the readiness rules need it.
 */
export async function syncOura(
  user: User,
  {
    windowDays = OURA_RETENTION_DAYS,
    collections = OURA_COLLECTIONS,
  }: { windowDays?: number; collections?: readonly OuraCollection[] } = {},
): Promise<OuraSyncResult> {
  const today = todayIn(user.timezone)
  const days = Math.min(windowDays, OURA_RETENTION_DAYS)
  const start = addDays(today, -(days - 1))

  type Fetched =
    | { collection: OuraCollection; records: NewRecord[] }
    | { collection: OuraCollection; error: unknown }
  const results = await mapConcurrently(
    collections,
    CONCURRENCY,
    async (collection): Promise<Fetched> => {
      try {
        return { collection, records: await fetchCollection(user, collection, start, today) }
      } catch (error) {
        return { collection, error }
      }
    },
  )
  const fetched = new Map<OuraCollection, NewRecord[]>()
  const errors: { collection: OuraCollection; error: unknown }[] = []
  for (const result of results) {
    if ('records' in result) fetched.set(result.collection, result.records)
    else errors.push(result)
  }
  const missing = errors.filter((r) => r.error instanceof MissingScopeError).map((r) => r.collection)
  const failed = errors.filter((r) => !(r.error instanceof MissingScopeError))

  let storedDays = 0
  await db.transaction(async (tx) => {
    // Disconnecting deletes the connection and the data in one transaction. Holding this lock
    // keeps it from running mid-write, and an already deleted connection means writing nothing.
    const [connection] = await tx
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.userId, user.id), eq(connections.provider, 'oura')))
      .for('share')
    if (!connection) return

    for (const [collection, records] of fetched) {
      const { kind } = COLLECTION_SHAPES[collection]
      const window = kind === 'documents' || kind === 'samples' ? { start, end: today } : 'all'
      await replaceRecords(tx, user.id, collection, records, window)
    }
    const readiness = fetched.get('daily_readiness')
    const sleep = fetched.get('sleep')
    if (readiness && sleep) {
      storedDays = await storeDailyValues(tx, user, start, today, readiness, sleep)
    }
  })

  if (collections.length === OURA_COLLECTIONS.length) {
    await updateConnectionMetadata(user.id, 'oura', {
      ouraMissingCollections: missing,
      ...(days === OURA_RETENTION_DAYS &&
        failed.length === 0 && { ouraBackfilledAt: new Date().toISOString() }),
    })
  }
  await purgeExpiredOuraData(user)

  const required = errors.find((r) => REQUIRED_COLLECTIONS.includes(r.collection))
  if (required) {
    if (required.error instanceof MissingScopeError) await markReauthRequired(user.id, 'oura')
    throw required.error
  }
  for (const { collection, error } of failed) {
    console.warn(`Oura ${collection} sync failed: ${(error as Error).message}`)
  }
  return { days: storedDays, missing, failed: failed.map((r) => r.collection) }
}

export async function purgeExpiredOuraData(user: User) {
  const oldestKept = addDays(todayIn(user.timezone), -(OURA_RETENTION_DAYS - 1))
  await db
    .delete(ouraDaily)
    .where(and(eq(ouraDaily.userId, user.id), lt(ouraDaily.day, oldestKept)))
  await deleteRecordsBefore(user.id, oldestKept)
  await db
    .delete(planAdjustments)
    .where(and(eq(planAdjustments.userId, user.id), lt(planAdjustments.decidedOn, oldestKept)))
}

/** Every day stored for the user, oldest first. */
export function getStoredOuraDays(userId: string) {
  return db
    .select({
      day: ouraDaily.day,
      readinessScore: ouraDaily.readinessScore,
      averageHrv: ouraDaily.averageHrv,
      restingHeartRate: ouraDaily.restingHeartRate,
    })
    .from(ouraDaily)
    .where(eq(ouraDaily.userId, userId))
    .orderBy(asc(ouraDaily.day))
}
