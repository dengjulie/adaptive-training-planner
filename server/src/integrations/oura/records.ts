import { and, asc, between, desc, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm'
import { db, type Transaction } from '../../db/client.ts'
import { ouraRecords, type OuraDocument } from '../../db/schema.ts'
import type { IsoDate } from '../../lib/dates.ts'
import type { OuraCollection } from './collections.ts'

export type NewRecord = { recordId: string; day: IsoDate | null; data: OuraDocument }

/** Rows per insert statement; a year of sleep documents is a few megabytes. */
const INSERT_BATCH = 100

/**
 * Makes one collection's stored records match what Oura returned: upserts `records` and deletes
 * the stored records Oura no longer has (deleted in the Oura app). Only days that were synced
 * are compared, or every record for collections without days.
 */
export async function replaceRecords(
  tx: Transaction,
  userId: string,
  collection: OuraCollection,
  records: NewRecord[],
  days: { start: IsoDate; end: IsoDate } | 'all',
) {
  const unique = [...new Map(records.map((record) => [record.recordId, record])).values()]
  await tx
    .delete(ouraRecords)
    .where(
      and(
        eq(ouraRecords.userId, userId),
        eq(ouraRecords.collection, collection),
        days === 'all' ? undefined : between(ouraRecords.day, days.start, days.end),
        unique.length > 0
          ? notInArray(
              ouraRecords.recordId,
              unique.map((record) => record.recordId),
            )
          : undefined,
      ),
    )
  for (let i = 0; i < unique.length; i += INSERT_BATCH) {
    await tx
      .insert(ouraRecords)
      .values(unique.slice(i, i + INSERT_BATCH).map((record) => ({ userId, collection, ...record })))
      .onConflictDoUpdate({
        target: [ouraRecords.userId, ouraRecords.collection, ouraRecords.recordId],
        set: { day: sql`excluded.day`, data: sql`excluded.data`, updatedAt: sql`now()` },
      })
  }
}

export async function deleteRecordsBefore(userId: string, day: IsoDate) {
  await db.delete(ouraRecords).where(and(eq(ouraRecords.userId, userId), lt(ouraRecords.day, day)))
}

/** Keys that hold time series or long per-interval encodings rather than one value. */
const TIME_SERIES_KEYS = [
  'samples',
  'heart_rate',
  'hrv',
  'heart_rate_variability',
  'motion_count',
  'met',
  'class_5_min',
  'movement_30_sec',
  'sleep_phase_5_min',
  'sleep_phase_30_sec',
  'app_sleep_phase_5_min',
]
// The keys are constants, so they're written into the SQL rather than bound one by one.
const TIME_SERIES_KEY_ARRAY = sql.raw(`array[${TIME_SERIES_KEYS.map((key) => `'${key}'`).join(', ')}]`)

/**
 * Dated documents from `start` on, oldest first, without their time series. Records of pure
 * time series (heart rate, ring battery) are left out; see getHeartRateStats.
 */
export function getRecordSummaries(userId: string, start: IsoDate) {
  return db
    .select({
      collection: ouraRecords.collection,
      day: ouraRecords.day,
      data: sql<OuraDocument>`${ouraRecords.data} - ${TIME_SERIES_KEY_ARRAY}`,
    })
    .from(ouraRecords)
    .where(
      and(
        eq(ouraRecords.userId, userId),
        gte(ouraRecords.day, start),
        notInArray(ouraRecords.collection, ['heartrate', 'ring_battery_level']),
      ),
    )
    .orderBy(asc(ouraRecords.day))
}

export type HeartRateStat = { day: IsoDate; source: string; min: number; avg: number; max: number }

/** The lowest, average, and highest heart rate sample per day and source, from `start` on. */
export async function getHeartRateStats(userId: string, start: IsoDate): Promise<HeartRateStat[]> {
  const result = await db.execute<HeartRateStat>(sql`
    select r.day::text as day, s->>'source' as source,
      min((s->>'bpm')::int) as min, avg((s->>'bpm')::int)::float8 as avg, max((s->>'bpm')::int) as max
    from ${ouraRecords} r, jsonb_array_elements(r.data->'samples') s
    where r.user_id = ${userId} and r.collection = 'heartrate' and r.day >= ${start}
    group by r.day, s->>'source'
  `)
  return result.rows
}

/** Every record of one day, time series included. */
export function getRecordsOfDay(userId: string, day: IsoDate) {
  return db
    .select({ collection: ouraRecords.collection, data: ouraRecords.data })
    .from(ouraRecords)
    .where(and(eq(ouraRecords.userId, userId), eq(ouraRecords.day, day)))
}

/** Records without a day: the user's profile and rings. */
export function getUndatedRecords(userId: string) {
  return db
    .select({ collection: ouraRecords.collection, data: ouraRecords.data })
    .from(ouraRecords)
    .where(and(eq(ouraRecords.userId, userId), isNull(ouraRecords.day)))
}

/** The most recent day's ring battery samples. */
export async function getLatestBatteryRecord(userId: string) {
  const [row] = await db
    .select({ data: ouraRecords.data })
    .from(ouraRecords)
    .where(and(eq(ouraRecords.userId, userId), eq(ouraRecords.collection, 'ring_battery_level')))
    .orderBy(desc(ouraRecords.day))
    .limit(1)
  return row?.data
}
