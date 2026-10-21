import { z } from 'zod'
import type { Connection } from '../../db/schema.ts'
import { ouraOAuth } from '../../env.ts'
import { expiresAtFromNow, type Refresher, type TokenSet } from '../../lib/connections.ts'
import { decryptSecret, sha256 } from '../../lib/crypto.ts'
import { NotConfiguredError, ReauthRequiredError, UpstreamError } from '../../lib/errors.ts'

const AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize'

/**
 * Every scope Oura offers (OpenAPI spec 1.41). The app stores and shows all of the user's Oura
 * data and the planner builds on it (README, "Data handling"); the Oura API agreement requires
 * that the app uses what it requests (§4(c), §5(g)), so drop a scope here if its data stops
 * being used. The user can untick scopes on the consent screen: `daily` is required (see
 * grantsDailyData), and the sync skips collections whose scope is missing.
 */
const SCOPES = [
  'email',
  'personal',
  'daily',
  'heartrate',
  'workout',
  'tag',
  'session',
  'spo2',
  'heart_health',
]

function config() {
  if (!ouraOAuth) throw new NotConfiguredError('oura')
  return ouraOAuth
}

type AuthServer = {
  tokenUrl: string
  revoke(connection: Connection): Promise<Response>
}

const LEGACY_SERVER: AuthServer = {
  tokenUrl: 'https://api.ouraring.com/oauth/token',
  revoke: (connection) =>
    fetch(
      `https://api.ouraring.com/oauth/revoke?access_token=${encodeURIComponent(decryptSecret(connection.accessToken))}`,
      { method: 'POST' },
    ),
}

/**
 * Apps registered on developer.ouraring.com are served by Oura's newer authorization server.
 * It names itself in the callback's `iss` parameter and only accepts its own token and revocation
 * endpoints; apps from the older portal have no `iss` and use api.ouraring.com.
 */
const SERVERS_BY_ISSUER: Record<string, AuthServer> = {
  'https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous': {
    tokenUrl: 'https://moi.ouraring.com/oauth/v2/ext/oauth-token',
    revoke: (connection) =>
      fetch('https://moi.ouraring.com/oauth/v2/ext/oauth-revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: decryptSecret(connection.refreshToken ?? connection.accessToken),
          client_id: config().clientId,
          client_secret: config().clientSecret,
        }),
      }),
  },
}

function authServerFor(issuer: string | undefined): AuthServer {
  if (issuer === undefined) return LEGACY_SERVER
  const server = SERVERS_BY_ISSUER[issuer]
  if (!server) throw new UpstreamError('oura', 400, `unrecognized authorization server ${issuer}`)
  return server
}

export function buildAuthorizationUrl(state: string, codeVerifier: string): string {
  const { clientId, redirectUri } = config()
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    code_challenge: sha256(codeVerifier),
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
})

async function requestTokens(issuer: string | undefined, params: Record<string, string>) {
  const { clientId, clientSecret } = config()
  const response = await fetch(authServerFor(issuer).tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
  })
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const { error, error_description } = (body ?? {}) as { error?: string; error_description?: string }
    const message = error_description ?? error ?? response.statusText
    // Refresh tokens are single-use; a rejected one (Oura answers 400) can't be retried.
    if (params.grant_type === 'refresh_token' && (response.status === 400 || response.status === 401)) {
      throw new ReauthRequiredError('oura', message)
    }
    throw new UpstreamError('oura', response.status, message)
  }

  const tokens = TokenResponse.parse(body)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiresAtFromNow(tokens.expires_in),
    // The newer server prefixes scopes ("extapi:daily"); store them plain.
    scope: tokens.scope
      ?.split(' ')
      .map((scope) => scope.replace(/^extapi:/, ''))
      .join(' '),
  } satisfies TokenSet
}

/** `issuer` is the callback's `iss` parameter, if Oura sent one. */
export function exchangeCode(code: string, codeVerifier: string, issuer: string | undefined) {
  return requestTokens(issuer, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: config().redirectUri,
  })
}

export const refreshOuraToken: Refresher = (refreshToken, connection) =>
  requestTokens(connection.metadata.issuer, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

/** True unless the token response lists scopes without `daily` (the user can untick it). */
export function grantsDailyData(tokens: TokenSet): boolean {
  return tokens.scope === undefined || tokens.scope.split(' ').includes('daily')
}

/** Best effort: stored data is deleted whether or not revocation succeeds. */
export async function revokeOuraAccess(connection: Connection) {
  try {
    const response = await authServerFor(connection.metadata.issuer).revoke(connection)
    if (!response.ok) console.warn(`Oura token revocation returned ${response.status}`)
  } catch (error) {
    console.warn('Oura token revocation failed:', error)
  }
}
