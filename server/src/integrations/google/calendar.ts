import { calendar, type calendar_v3 } from '@googleapis/calendar'
import { eq } from 'drizzle-orm'
import { OAuth2Client } from 'google-auth-library'
import { db } from '../../db/client.ts'
import { users, type User } from '../../db/schema.ts'
import { getAccessToken } from '../../lib/connections.ts'
import { UpstreamError } from '../../lib/errors.ts'
import { refreshGoogleToken } from './oauth.ts'

const TRAINING_CALENDAR_NAME = 'Training'
/** Private extended property that marks an event as a planned session this app manages. */
const SESSION_ID_PROPERTY = 'trainSmarterSessionId'

const httpStatus = (error: unknown) =>
  (error as { response?: { status?: number } }).response?.status

function calendarApi(accessToken: string) {
  // No refresh token here on purpose: refreshes go through the connection store's row lock.
  const auth = new OAuth2Client()
  auth.setCredentials({ access_token: accessToken })
  return calendar({ version: 'v3', auth })
}

/** Runs `fn` with a Calendar client, refreshing the token and retrying once on a 401. */
async function withCalendar<T>(
  userId: string,
  fn: (api: calendar_v3.Calendar) => Promise<T>,
): Promise<T> {
  const accessToken = await getAccessToken(userId, 'google', refreshGoogleToken)
  try {
    try {
      return await fn(calendarApi(accessToken))
    } catch (error) {
      if (httpStatus(error) !== 401) throw error
      const refreshed = await getAccessToken(userId, 'google', refreshGoogleToken, {
        rejectedToken: accessToken,
      })
      return await fn(calendarApi(refreshed))
    }
  } catch (error) {
    const status = httpStatus(error)
    throw status ? new UpstreamError('google', status, (error as Error).message) : error
  }
}

/**
 * Returns the user's "Training" calendar, creating it on first use (or again if the user deleted
 * it). The user row is locked meanwhile so concurrent requests can't create two calendars.
 */
export async function ensureTrainingCalendar(userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) throw new Error(`Unknown user ${userId}`)

    return withCalendar(userId, async (api) => {
      if (user.trainingCalendarId) {
        try {
          return (await api.calendars.get({ calendarId: user.trainingCalendarId })).data
        } catch (error) {
          if (httpStatus(error) !== 404) throw error
        }
      }
      const { data } = await api.calendars.insert({
        requestBody: {
          summary: TRAINING_CALENDAR_NAME,
          description: 'Sessions planned by Train Smarter. Edits here may be overwritten when the plan changes.',
          timeZone: user.timezone,
        },
      })
      await tx.update(users).set({ trainingCalendarId: data.id }).where(eq(users.id, userId))
      return data
    })
  })
}

export type BusyBlock = { start: string; end: string }

/** Busy blocks on the user's primary calendar. The scope only exposes times, never event details. */
export async function getBusyTimes(userId: string, timeMin: Date, timeMax: Date) {
  return withCalendar(userId, async (api): Promise<BusyBlock[]> => {
    const { data } = await api.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }],
      },
    })
    const primary = data.calendars?.primary
    const error = primary?.errors?.[0]
    if (error) throw new UpstreamError('google', 502, `free/busy lookup failed: ${error.reason}`)
    return (primary?.busy ?? []).flatMap(({ start, end }) => (start && end ? [{ start, end }] : []))
  })
}

export type SessionEvent = {
  sessionId: string
  summary: string
  description?: string
  /** RFC 3339 timestamps, e.g. 2026-10-12T07:00:00-07:00 */
  start: string
  end: string
}

async function findSessionEvent(api: calendar_v3.Calendar, calendarId: string, sessionId: string) {
  const { data } = await api.events.list({
    calendarId,
    privateExtendedProperty: [`${SESSION_ID_PROPERTY}=${sessionId}`],
    maxResults: 1,
  })
  return data.items?.[0]
}

/** Creates or updates the event for a planned session on the Training calendar. */
export async function upsertSessionEvent(user: User, calendarId: string, session: SessionEvent) {
  return withCalendar(user.id, async (api) => {
    const requestBody: calendar_v3.Schema$Event = {
      summary: session.summary,
      description: session.description,
      start: { dateTime: session.start, timeZone: user.timezone },
      end: { dateTime: session.end, timeZone: user.timezone },
      extendedProperties: { private: { [SESSION_ID_PROPERTY]: session.sessionId } },
    }
    const existing = await findSessionEvent(api, calendarId, session.sessionId)
    const { data } = existing?.id
      ? await api.events.patch({ calendarId, eventId: existing.id, requestBody })
      : await api.events.insert({ calendarId, requestBody })
    return data
  })
}

export async function deleteSessionEvent(user: User, calendarId: string, sessionId: string) {
  await withCalendar(user.id, async (api) => {
    const existing = await findSessionEvent(api, calendarId, sessionId)
    if (existing?.id) await api.events.delete({ calendarId, eventId: existing.id })
  })
}
