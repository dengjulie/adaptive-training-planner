import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { googleOAuth } from '../../env.ts'
import type { Refresher, TokenSet } from '../../lib/connections.ts'
import { NotConfiguredError, ReauthRequiredError } from '../../lib/errors.ts'
import { OAuthCallbackError } from '../../lib/oauth-state.ts'

/**
 * The narrowest scopes that cover the README: create the app's own "Training" calendar and
 * manage events only on it, and see free/busy times (never event details) on the user's calendars.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.freebusy',
]
const SCOPES = ['openid', 'email', ...CALENDAR_SCOPES]

function oauthClient() {
  if (!googleOAuth) throw new NotConfiguredError('google')
  return new OAuth2Client({
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    redirectUri: googleOAuth.redirectUri,
  })
}

const oauthErrorCode = (error: unknown) =>
  (error as { response?: { data?: { error?: unknown } } }).response?.data?.error

/**
 * Builds Google's consent URL. Google only issues a refresh token on consent, so `forceConsent`
 * is used when we have no working refresh token; otherwise returning users skip the consent screen.
 */
export async function buildAuthorizationUrl(state: string, forceConsent: boolean) {
  const client = oauthClient()
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    ...(forceConsent && { prompt: 'consent' }),
  })
  return { url, codeVerifier }
}

/** Exchanges the callback code, verifies the ID token, and reports scopes the user unticked. */
export async function exchangeCode(code: string, codeVerifier: string) {
  const client = oauthClient()
  const { tokens } = await client.getToken({ code, codeVerifier })
  if (!tokens.access_token || !tokens.id_token) {
    throw new OAuthCallbackError('Google returned an incomplete token response.')
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleOAuth?.clientId,
  })
  const payload = ticket.getPayload()
  if (!payload?.email || !payload.email_verified) {
    throw new OAuthCallbackError('Your Google account needs a verified email address.')
  }

  const granted = new Set(tokens.scope?.split(' '))
  const result: TokenSet = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? undefined,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? undefined,
  }
  return {
    identity: { sub: payload.sub, email: payload.email },
    tokens: result,
    missingScopes: CALENDAR_SCOPES.filter((scope) => !granted.has(scope)),
  }
}

export const refreshGoogleToken: Refresher = async (refreshToken) => {
  const client = oauthClient()
  client.setCredentials({ refresh_token: refreshToken })
  try {
    const { token } = await client.getAccessToken()
    if (!token) throw new Error('Google returned no access token')
    const { expiry_date, scope } = client.credentials
    return {
      accessToken: token,
      expiresAt: expiry_date ? new Date(expiry_date) : null,
      scope: scope ?? undefined,
    }
  } catch (error) {
    // Revoked, unused for six months, or a 7-day "Testing" mode token that expired.
    if (oauthErrorCode(error) === 'invalid_grant') throw new ReauthRequiredError('google', error)
    throw error
  }
}

/** Best effort. Revoking any token from the grant removes every scope Google gave this app. */
export async function revokeGoogleGrant(token: string) {
  try {
    await oauthClient().revokeToken(token)
  } catch (error) {
    console.warn('Google token revocation failed:', error)
  }
}
