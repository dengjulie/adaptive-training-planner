import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { Provider } from '../db/schema.ts'
import { appOrigin, env, secureCookies } from '../env.ts'
import { safeEqual } from './crypto.ts'

/**
 * State carried across an OAuth redirect. It lives in a short-lived, signed, httpOnly cookie
 * scoped to /auth/<provider>, so a callback can only complete a flow this browser started.
 */
export type PendingAuthorization = {
  state: string
  codeVerifier?: string
  /** Free-form values the start handler wants back in the callback. */
  extra?: Record<string, string>
}

const cookieName = (provider: Provider) => `ts_oauth_${provider}`
const cookiePath = (provider: Provider) => `/auth/${provider}`

export async function savePendingAuthorization(
  c: Context,
  provider: Provider,
  pending: PendingAuthorization,
) {
  const value = Buffer.from(JSON.stringify(pending)).toString('base64url')
  await setSignedCookie(c, cookieName(provider), value, env.SESSION_SECRET, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'Lax',
    path: cookiePath(provider),
    maxAge: 10 * 60,
  })
}

export class OAuthCallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthCallbackError'
  }
}

/** Reads and clears the pending authorization, verifying the `state` the provider sent back. */
export async function consumePendingAuthorization(
  c: Context,
  provider: Provider,
): Promise<PendingAuthorization> {
  const error = c.req.query('error')
  if (error) {
    throw new OAuthCallbackError(
      error === 'access_denied' ? 'Access was not granted.' : `Authorization failed: ${error}`,
    )
  }

  const value = await getSignedCookie(c, env.SESSION_SECRET, cookieName(provider))
  deleteCookie(c, cookieName(provider), { path: cookiePath(provider), secure: secureCookies })
  if (!value) throw new OAuthCallbackError('The sign-in attempt expired. Please try again.')

  const pending = JSON.parse(Buffer.from(value, 'base64url').toString()) as PendingAuthorization
  const returnedState = c.req.query('state')
  if (!returnedState || !safeEqual(pending.state, returnedState)) {
    throw new OAuthCallbackError('OAuth state mismatch. Please try again.')
  }
  return pending
}

/** Sends the browser back to the web app with a status the UI can show. */
export function redirectToApp(
  c: Context,
  result: { connected: Provider } | { error: string; provider?: Provider },
) {
  const url = new URL('/connections', appOrigin)
  if ('connected' in result) {
    url.searchParams.set('connected', result.connected)
  } else {
    url.searchParams.set('error', result.error)
    if (result.provider) url.searchParams.set('provider', result.provider)
  }
  return c.redirect(url.toString())
}
