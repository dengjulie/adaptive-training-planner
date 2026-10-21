import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, pool } from '../../db/client.ts'
import { ouraDaily, ouraRecords, users, type User } from '../../db/schema.ts'
import { getConnection, saveConnection } from '../../lib/connections.ts'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.ts'
import { MissingScopeError } from '../../lib/errors.ts'
import { getDocuments, getSamples, getSingleDocument, getUndatedDocuments } from './client.ts'
import type { OuraCollection } from './collections.ts'
import { ouraIntegration } from './index.ts'
import { samplesByDay, syncOura } from './sync.ts'

vi.mock('./client.ts', () => ({
  getDocuments: vi.fn(),
  getSamples: vi.fn(),
  getUndatedDocuments: vi.fn(),
  getSingleDocument: vi.fn(),
}))
vi.mock('./oauth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oauth.ts')>()),
  revokeOuraAccess: vi.fn(),
}))

const today = todayIn('UTC')

function daysFrom(start: IsoDate, end: IsoDate) {
  const days: IsoDate[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day)
  return days
}

/** A fake Oura account: readiness and a night's sleep every day, plus the given workouts. */
function mockOura({ missing = [] as OuraCollection[], workouts = ['w1'] } = {}) {
  vi.mocked(getDocuments).mockImplementation(async (_userId, collection, start, end) => {
    if (missing.includes(collection)) throw new MissingScopeError('oura', 'missing scope')
    const days = daysFrom(start, end)
    switch (collection) {
      case 'daily_readiness':
        return days.map((day) => ({ id: `r-${day}`, day, score: 80 }))
      case 'sleep':
        return days.map((day) => ({
          id: `s-${day}`,
          day,
          type: 'long_sleep',
          bedtime_start: `${addDays(day, -1)}T23:00:00+00:00`,
          bedtime_end: `${day}T07:00:00+00:00`,
          total_sleep_duration: 28_000,
          average_hrv: 50,
          lowest_heart_rate: 48,
        }))
      case 'workout':
        return workouts.map((id) => ({ id, day: end, activity: 'running' }))
      default:
        return []
    }
  })
  vi.mocked(getSamples).mockImplementation(async (_userId, collection) =>
    collection === 'heartrate' ? [{ timestamp: `${today}T10:00:00+00:00`, bpm: 70, source: 'awake' }] : [],
  )
  vi.mocked(getUndatedDocuments).mockResolvedValue([{ id: 'ring-1', color: 'silver' }])
  vi.mocked(getSingleDocument).mockResolvedValue({ id: 'me', age: 35 })
}

async function countRecords(collection?: OuraCollection) {
  const rows = await db
    .select({ recordId: ouraRecords.recordId })
    .from(ouraRecords)
    .where(and(eq(ouraRecords.userId, user.id), collection && eq(ouraRecords.collection, collection)))
  return rows.length
}

let user: User

beforeEach(async () => {
  await db.delete(users)
  ;[user] = (await db
    .insert(users)
    .values({ googleSub: 'test-sub', email: 'test@example.invalid' })
    .returning()) as [User]
  await saveConnection(user.id, 'oura', { accessToken: 'token', refreshToken: 'refresh' })
  vi.clearAllMocks()
})

afterAll(() => pool.end())

describe('syncOura', () => {
  it('stores what Oura returns and derives the daily values the rules use', async () => {
    mockOura({ missing: ['daily_spo2'] })
    const result = await syncOura(user, { windowDays: 3 })

    expect(result).toEqual({ days: 3, missing: ['daily_spo2'], failed: [] })
    expect(await countRecords('daily_readiness')).toBe(3)
    expect(await countRecords('sleep')).toBe(3)
    expect(await countRecords('heartrate')).toBe(1)
    expect(await countRecords('ring_configuration')).toBe(1)
    expect(await countRecords('personal_info')).toBe(1)
    const [latest] = await db.select().from(ouraDaily).where(eq(ouraDaily.day, today))
    expect(latest).toMatchObject({ readinessScore: 80, averageHrv: 50, restingHeartRate: 48 })
    const connection = await getConnection(user.id, 'oura')
    expect(connection?.metadata.ouraMissingCollections).toEqual(['daily_spo2'])
  })

  it('deletes what was deleted in Oura', async () => {
    mockOura({ workouts: ['w1', 'w2'] })
    await syncOura(user, { windowDays: 3 })
    mockOura({ workouts: ['w1'] })
    await syncOura(user, { windowDays: 3 })
    expect(await countRecords('workout')).toBe(1)
  })

  it('deletes all Oura data on disconnect', async () => {
    mockOura()
    await syncOura(user, { windowDays: 3 })
    await ouraIntegration.disconnect(user.id)
    expect(await countRecords()).toBe(0)
    expect(await db.select().from(ouraDaily)).toEqual([])
    expect(await getConnection(user.id, 'oura')).toBeUndefined()
  })

  it('writes nothing when Oura is disconnected while a sync is still fetching', async () => {
    mockOura()
    const fetchDocuments = vi.mocked(getDocuments).getMockImplementation()
    let finishFetching = () => {}
    const fetching = new Promise<void>((resolve) => (finishFetching = resolve))
    vi.mocked(getDocuments).mockImplementation(async (...args) => {
      await fetching
      return fetchDocuments?.(...args) ?? []
    })

    const sync = syncOura(user, { windowDays: 3 })
    await ouraIntegration.disconnect(user.id)
    finishFetching()
    await sync
    expect(await countRecords()).toBe(0)
    expect(await db.select().from(ouraDaily)).toEqual([])
  })

  it('asks the user to reconnect when readiness was not shared', async () => {
    mockOura({ missing: ['daily_readiness'] })
    await expect(syncOura(user, { windowDays: 3 })).rejects.toBeInstanceOf(MissingScopeError)
    expect((await getConnection(user.id, 'oura'))?.status).toBe('reauth_required')
  })
})

describe('samplesByDay', () => {
  it('groups UTC samples by local day and keeps only the days asked for', () => {
    const samples = [
      { timestamp: '2026-03-02T07:30:00+00:00', bpm: 60 }, // 23:30 on Mar 1 in Los Angeles
      { timestamp: '2026-03-02T09:00:00+00:00', bpm: 62 }, // 01:00 on Mar 2
      { timestamp: '2026-03-02T18:00:00+00:00', bpm: 90 }, // 10:00 on Mar 2
    ]
    const records = samplesByDay(samples, 'America/Los_Angeles', '2026-03-02', '2026-03-02')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ recordId: '2026-03-02', day: '2026-03-02' })
    expect(records[0]?.data.samples).toHaveLength(2)
  })
})
