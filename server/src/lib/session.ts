import { and, eq, gt } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { db } from '../db/client.ts'
import { sessions, users, type User } from '../db/schema.ts'
import { secureCookies } from '../env.ts'
import { randomToken, sha256 } from './crypto.ts'
import { OAuthCallbackError } from './oauth-state.ts'

const SESSION_COOKIE = 'ts_session'
const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_TTL_MS = 30 * DAY_MS
const RENEW_WHEN_REMAINING_MS = 15 * DAY_MS

export type AppEnv = { Variables: { user: User } }

function setSessionCookie(c: Context, token: string, expires: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

export async function startSession(c: Context, userId: string) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt })
  setSessionCookie(c, token, expiresAt)
}

export async function endSession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)))
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secureCookies })
}

/** Returns the signed-in user, sliding the session's expiry forward when it's half used. */
export async function getSessionUser(c: Context): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null

  const id = sha256(token)
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row) return null

  if (row.expiresAt.getTime() - Date.now() < RENEW_WHEN_REMAINING_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
    setSessionCookie(c, token, expiresAt)
  }
  return row.user
}

/** For browser-navigation routes under /auth; app.onError turns the throw into a redirect. */
export async function requireSessionUser(c: Context): Promise<User> {
  const user = await getSessionUser(c)
  if (!user) throw new OAuthCallbackError('Please sign in first.')
  return user
}

/** For JSON API routes: 401 unless signed in. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'unauthenticated' }, 401)
  c.set('user', user)
  await next()
})
