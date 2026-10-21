import { Hono } from 'hono'
import { db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import { allowedEmails } from '../../env.ts'
import { getConnection, saveConnection } from '../../lib/connections.ts'
import { randomToken } from '../../lib/crypto.ts'
import { isValidTimeZone } from '../../lib/dates.ts'
import {
  consumePendingAuthorization,
  OAuthCallbackError,
  redirectToApp,
  savePendingAuthorization,
} from '../../lib/oauth-state.ts'
import { getSessionUser, startSession, type AppEnv } from '../../lib/session.ts'
import { ensureTrainingCalendar, getBusyTimes } from './calendar.ts'
import { buildAuthorizationUrl, exchangeCode } from './oauth.ts'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Google sign-in doubles as the Calendar connection: one consent covers both. */
export const googleRoutes = new Hono<AppEnv>()
  .get('/auth/google/start', async (c) => {
    const timezone = c.req.query('tz')
    const forceConsent = c.req.query('consent') === '1'
    const state = randomToken()
    const { url, codeVerifier } = await buildAuthorizationUrl(state, forceConsent)
    await savePendingAuthorization(c, 'google', {
      state,
      codeVerifier,
      extra: {
        ...(timezone && isValidTimeZone(timezone) && { timezone }),
        ...(forceConsent && { consent: '1' }),
      },
    })
    return c.redirect(url)
  })

  .get('/auth/google/callback', async (c) => {
    const pending = await consumePendingAuthorization(c, 'google')
    const code = c.req.query('code')
    if (!code || !pending.codeVerifier) {
      throw new OAuthCallbackError('Google did not return an authorization code.')
    }
    const { identity, tokens, missingScopes } = await exchangeCode(code, pending.codeVerifier)

    if (allowedEmails.size > 0 && !allowedEmails.has(identity.email.toLowerCase())) {
      throw new OAuthCallbackError(`${identity.email} is not allowed to sign in.`)
    }
    if (missingScopes.length > 0) {
      throw new OAuthCallbackError(
        'Calendar access is required. Allow both calendar permissions on the Google consent screen.',
      )
    }
    const sessionUser = await getSessionUser(c)
    if (sessionUser && sessionUser.googleSub !== identity.sub) {
      throw new OAuthCallbackError(
        `You're signed in as ${sessionUser.email}. Sign out before using another Google account.`,
      )
    }

    const [user] = await db
      .insert(users)
      .values({
        googleSub: identity.sub,
        email: identity.email,
        ...(pending.extra?.timezone && { timezone: pending.extra.timezone }),
      })
      .onConflictDoUpdate({ target: users.googleSub, set: { email: identity.email } })
      .returning()

    // Google only sends a refresh token on consent. If we don't hold a working one, ask once more
    // with prompt=consent rather than forcing the consent screen on every sign-in.
    const existing = await getConnection(user.id, 'google')
    const hasWorkingRefreshToken = existing?.refreshToken && existing.status === 'active'
    if (!tokens.refreshToken && !hasWorkingRefreshToken) {
      if (pending.extra?.consent) {
        throw new OAuthCallbackError(
          'Google did not issue a refresh token. Remove Train Smarter at myaccount.google.com/permissions and try again.',
        )
      }
      const retry = new URLSearchParams({ consent: '1' })
      if (pending.extra?.timezone) retry.set('tz', pending.extra.timezone)
      return c.redirect(`/auth/google/start?${retry}`)
    }

    await saveConnection(user.id, 'google', tokens, { externalAccountId: identity.sub })
    if (!sessionUser) await startSession(c, user.id)
    return redirectToApp(c, { connected: 'google' })
  })

  .get('/api/google/overview', async (c) => {
    const user = c.get('user')
    const calendar = await ensureTrainingCalendar(user.id)
    const now = new Date()
    const busy = await getBusyTimes(user.id, now, new Date(now.getTime() + WEEK_MS))
    return c.json({
      calendar: { id: calendar.id, summary: calendar.summary, timeZone: calendar.timeZone ?? null },
      busy,
    })
  })
