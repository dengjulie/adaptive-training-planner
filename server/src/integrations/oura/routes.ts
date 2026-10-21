import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { OuraDocument } from '../../db/schema.ts'
import { getConnection, saveConnection } from '../../lib/connections.ts'
import { randomToken } from '../../lib/crypto.ts'
import { addDays, todayIn } from '../../lib/dates.ts'
import {
  consumePendingAuthorization,
  OAuthCallbackError,
  redirectToApp,
  savePendingAuthorization,
} from '../../lib/oauth-state.ts'
import { requireSessionUser, type AppEnv } from '../../lib/session.ts'
import { trendDays } from './baseline.ts'
import { REQUIRED_COLLECTIONS } from './collections.ts'
import { buildAuthorizationUrl, exchangeCode, grantsDailyData } from './oauth.ts'
import {
  getHeartRateStats,
  getLatestBatteryRecord,
  getRecordSummaries,
  getRecordsOfDay,
  getUndatedRecords,
} from './records.ts'
import { getStoredOuraDays, OURA_RETENTION_DAYS, RECENT_SYNC_DAYS, syncOura } from './sync.ts'
import { buildTrends } from './trends.ts'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export const ouraRoutes = new Hono<AppEnv>()
  .get('/auth/oura/start', async (c) => {
    await requireSessionUser(c)
    const state = randomToken()
    const codeVerifier = randomToken(48)
    const url = buildAuthorizationUrl(state, codeVerifier)
    await savePendingAuthorization(c, 'oura', { state, codeVerifier })
    return c.redirect(url)
  })

  .get('/auth/oura/callback', async (c) => {
    const user = await requireSessionUser(c)
    if (c.req.query('error') === 'invalid_scope') {
      throw new OAuthCallbackError(
        'Oura rejected the requested permissions. Enable every scope for your app in the Oura developer portal, then connect again.',
      )
    }
    const pending = await consumePendingAuthorization(c, 'oura')
    const code = c.req.query('code')
    if (!code || !pending.codeVerifier) {
      throw new OAuthCallbackError('Oura did not return an authorization code.')
    }

    const issuer = c.req.query('iss')
    const tokens = await exchangeCode(code, pending.codeVerifier, issuer)
    if (!grantsDailyData(tokens)) {
      throw new OAuthCallbackError(
        'Oura did not grant access to daily data. Enable the "daily" scope for your app in the Oura developer portal and approve it when connecting.',
      )
    }
    await saveConnection(user.id, 'oura', tokens, { metadata: issuer ? { issuer } : {} })

    // Readiness and sleep first, so the baseline has data right away. The rest of the year
    // follows in the background; the sync that completes it records ouraBackfilledAt.
    try {
      await syncOura(user, { collections: REQUIRED_COLLECTIONS })
    } catch (error) {
      console.error('Initial Oura sync failed:', error)
    }
    void syncOura(user).catch((error: unknown) => console.error('Oura backfill failed:', error))
    return redirectToApp(c, { connected: 'oura' })
  })

  // Every day in the retention window, each with the normal range it's compared against.
  .get('/api/oura/daily', async (c) => {
    const user = c.get('user')
    const today = todayIn(user.timezone)
    const start = addDays(today, -(OURA_RETENTION_DAYS - 1))
    return c.json({ days: trendDays(await getStoredOuraDays(user.id), start, today) })
  })

  // Every stored value laid out day by day over the retention window (see trends.ts).
  .get('/api/oura/trends', async (c) => {
    const user = c.get('user')
    const today = todayIn(user.timezone)
    const start = addDays(today, -(OURA_RETENTION_DAYS - 1))
    const [summaries, heartRate] = await Promise.all([
      getRecordSummaries(user.id, start),
      getHeartRateStats(user.id, start),
    ])
    return c.json(buildTrends(summaries, heartRate, start, today, user.timezone))
  })

  // Everything stored for one day, time series included, grouped by collection.
  .get('/api/oura/days/:day', async (c) => {
    const day = c.req.param('day')
    if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) {
      throw new HTTPException(400, { message: 'Expected a day like 2026-10-11' })
    }
    const records: Record<string, OuraDocument[]> = {}
    for (const { collection, data } of await getRecordsOfDay(c.get('user').id, day)) {
      ;(records[collection] ??= []).push(data)
    }
    return c.json({ day, records })
  })

  // The user's Oura profile and rings, and what the connection can and can't read.
  .get('/api/oura/profile', async (c) => {
    const user = c.get('user')
    const [connection, undated, battery] = await Promise.all([
      getConnection(user.id, 'oura'),
      getUndatedRecords(user.id),
      getLatestBatteryRecord(user.id),
    ])
    const batterySamples = Array.isArray(battery?.samples) ? (battery.samples as unknown[]) : []
    return c.json({
      personalInfo: undated.find((record) => record.collection === 'personal_info')?.data ?? null,
      rings: undated
        .filter((record) => record.collection === 'ring_configuration')
        .map((record) => record.data),
      battery: batterySamples.at(-1) ?? null,
      missingCollections: connection?.metadata.ouraMissingCollections ?? [],
      backfilledAt: connection?.metadata.ouraBackfilledAt ?? null,
    })
  })

  .post('/api/oura/sync', async (c) => {
    const user = c.get('user')
    const connection = await getConnection(user.id, 'oura')
    // Stored days rarely change, so once the year is in, re-read only the recent ones.
    const windowDays = connection?.metadata.ouraBackfilledAt ? RECENT_SYNC_DAYS : OURA_RETENTION_DAYS
    return c.json(await syncOura(user, { windowDays }))
  })
