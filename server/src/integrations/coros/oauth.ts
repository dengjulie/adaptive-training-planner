import {
  auth,
  discoverOAuthServerInfo,
  OAuthError,
  refreshAuthorization,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { oauthClients } from '../../db/schema.ts'
import { corosConfig } from '../../env.ts'
import { expiresAtFromNow, type Refresher, type TokenSet } from '../../lib/connections.ts'
import { decryptSecret, encryptSecret, randomToken } from '../../lib/crypto.ts'
import { ReauthRequiredError } from '../../lib/errors.ts'

export const corosServerUrl = new URL(corosConfig.mcpUrl)

const byIssuer = (issuer: string) =>
  and(eq(oauthClients.issuer, issuer), eq(oauthClients.redirectUri, corosConfig.redirectUri))

async function loadClient(issuer: string) {
  const [row] = await db.select().from(oauthClients).where(byIssuer(issuer))
  return row
    ? (JSON.parse(decryptSecret(row.clientInformation)) as StoredOAuthClientInformation)
    : undefined
}

async function storeClient(issuer: string, information: StoredOAuthClientInformation) {
  const clientInformation = encryptSecret(JSON.stringify(information))
  await db
    .insert(oauthClients)
    .values({ issuer, redirectUri: corosConfig.redirectUri, clientInformation })
    .onConflictDoUpdate({
      target: [oauthClients.issuer, oauthClients.redirectUri],
      set: { clientInformation },
    })
}

/**
 * Adapter for the MCP SDK's auth() orchestrator, which runs discovery, dynamic client
 * registration, PKCE, and the code exchange. Each instance serves one step of the browser flow
 * and captures its result; tokens are persisted by the caller through lib/connections.ts.
 */
class CorosAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined
  codeVerifierValue: string | undefined
  savedTokens: StoredOAuthTokens | undefined
  private readonly stateValue: string
  private issuer: string | undefined

  constructor(options: { state?: string; codeVerifier?: string } = {}) {
    this.stateValue = options.state ?? randomToken()
    this.codeVerifierValue = options.codeVerifier
  }

  get redirectUrl() {
    return corosConfig.redirectUri
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Train Smarter',
      redirect_uris: [corosConfig.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // COROS registers public clients: there is no client secret to keep.
      token_endpoint_auth_method: 'none',
    }
  }

  state() {
    return this.stateValue
  }

  async clientInformation(context?: { issuer: string }) {
    if (!context) return undefined
    this.issuer = context.issuer
    return loadClient(context.issuer)
  }

  async saveClientInformation(
    information: StoredOAuthClientInformation,
    context?: { issuer: string },
  ) {
    const issuer = context?.issuer ?? information.issuer
    if (issuer) await storeClient(issuer, information)
  }

  tokens() {
    return undefined // connecting always starts a fresh authorization
  }

  saveTokens(tokens: StoredOAuthTokens) {
    this.savedTokens = tokens
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url
  }

  saveCodeVerifier(codeVerifier: string) {
    this.codeVerifierValue = codeVerifier
  }

  codeVerifier() {
    if (!this.codeVerifierValue) throw new Error('Missing PKCE code verifier')
    return this.codeVerifierValue
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    // The registration was rejected (invalid_client): drop it so auth() registers a new client.
    if ((scope === 'all' || scope === 'client') && this.issuer) {
      await db.delete(oauthClients).where(byIssuer(this.issuer))
    }
  }
}

function toTokenSet(tokens: OAuthTokens): TokenSet {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiresAtFromNow(tokens.expires_in),
    scope: tokens.scope,
  }
}

/** Discovers COROS's authorization server, registers on first use, and returns its login URL. */
export async function startCorosAuthorization(state: string) {
  const provider = new CorosAuthProvider({ state })
  const result = await auth(provider, { serverUrl: corosServerUrl })
  if (result !== 'REDIRECT' || !provider.authorizationUrl || !provider.codeVerifierValue) {
    throw new Error('COROS authorization did not produce a login URL')
  }
  return { url: provider.authorizationUrl.toString(), codeVerifier: provider.codeVerifierValue }
}

/** `iss` is the callback's issuer parameter; auth() validates it (RFC 9207) before redeeming. */
export async function completeCorosAuthorization(
  code: string,
  codeVerifier: string,
  iss: string | undefined,
) {
  const provider = new CorosAuthProvider({ codeVerifier })
  await auth(provider, { serverUrl: corosServerUrl, authorizationCode: code, iss })
  if (!provider.savedTokens) throw new Error('COROS did not return tokens')
  return { tokens: toTokenSet(provider.savedTokens), issuer: provider.savedTokens.issuer }
}

/**
 * Refreshes with the SDK's low-level helper instead of auth(): auth() quietly falls back to a
 * new interactive login on any refresh failure, which in a background job would turn a COROS
 * outage into "reconnect required". COROS rotates refresh tokens, so this runs under the
 * connection's row lock (see getAccessToken).
 */
export const refreshCorosToken: Refresher = async (refreshToken) => {
  const server = await discoverOAuthServerInfo(corosServerUrl)
  const issuer = server.authorizationServerMetadata?.issuer ?? server.authorizationServerUrl
  const clientInformation = await loadClient(issuer)
  if (!clientInformation) throw new ReauthRequiredError('coros')

  try {
    const tokens = await refreshAuthorization(server.authorizationServerUrl, {
      metadata: server.authorizationServerMetadata,
      clientInformation,
      refreshToken,
      resource: server.resourceMetadata?.resource ?? corosServerUrl,
    })
    return toTokenSet(tokens)
  } catch (error) {
    if (
      error instanceof OAuthError &&
      ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(error.code)
    ) {
      throw new ReauthRequiredError('coros', error)
    }
    throw error
  }
}
