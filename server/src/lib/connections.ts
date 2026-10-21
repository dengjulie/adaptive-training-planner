import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import {
  connections,
  type Connection,
  type ConnectionMetadata,
  type Provider,
} from '../db/schema.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'
import { NotConnectedError, ReauthRequiredError } from './errors.ts'

export type TokenSet = {
  accessToken: string
  /** Omit to keep the stored refresh token (some providers only send it on first consent). */
  refreshToken?: string
  expiresAt?: Date | null
  scope?: string
}

/**
 * Exchanges a refresh token for new tokens. Implementations throw ReauthRequiredError when the
 * provider rejects the refresh token (invalid_grant), and other errors for transient failures.
 */
export type Refresher = (refreshToken: string, connection: Connection) => Promise<TokenSet>

/** Refresh access tokens that have less than this long left. */
const EXPIRY_SKEW_MS = 2 * 60 * 1000

export function expiresAtFromNow(expiresInSeconds: number | undefined): Date | null {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null
}

function isExpiring(connection: Connection): boolean {
  const expiresAt = connection.accessTokenExpiresAt
  return expiresAt !== null && expiresAt.getTime() - Date.now() < EXPIRY_SKEW_MS
}

const byUserAndProvider = (userId: string, provider: Provider) =>
  and(eq(connections.userId, userId), eq(connections.provider, provider))

export async function getConnection(userId: string, provider: Provider) {
  const [row] = await db.select().from(connections).where(byUserAndProvider(userId, provider))
  return row
}

export async function listConnections(userId: string) {
  return db.select().from(connections).where(eq(connections.userId, userId))
}

/** Creates or replaces a user's connection after a successful OAuth flow. */
export async function saveConnection(
  userId: string,
  provider: Provider,
  tokens: TokenSet,
  details: { externalAccountId?: string; metadata?: ConnectionMetadata } = {},
) {
  const values = {
    status: 'active' as const,
    accessToken: encryptSecret(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt ?? null,
    scope: tokens.scope ?? null,
    ...(tokens.refreshToken !== undefined && {
      refreshToken: encryptSecret(tokens.refreshToken),
    }),
    ...(details.externalAccountId !== undefined && {
      externalAccountId: details.externalAccountId,
    }),
    ...(details.metadata !== undefined && { metadata: details.metadata }),
  }
  await db
    .insert(connections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [connections.userId, connections.provider], set: values })
}

/** Shallow-merges keys into the connection's metadata. */
export async function updateConnectionMetadata(
  userId: string,
  provider: Provider,
  patch: Partial<ConnectionMetadata>,
) {
  await db
    .update(connections)
    .set({ metadata: sql`${connections.metadata} || ${JSON.stringify(patch)}::jsonb` })
    .where(byUserAndProvider(userId, provider))
}

export async function deleteConnection(userId: string, provider: Provider) {
  await db.delete(connections).where(byUserAndProvider(userId, provider))
}

/** Flags a connection whose credentials stopped working; the UI then offers "Reconnect". */
export async function markReauthRequired(userId: string, provider: Provider) {
  await db
    .update(connections)
    .set({ status: 'reauth_required' })
    .where(byUserAndProvider(userId, provider))
}

/**
 * Returns a usable access token, refreshing it first when it is about to expire or when the
 * caller reports that `rejectedToken` got a 401. Refreshes run under a row lock so concurrent
 * callers (a web request and the daily job) never both spend a single-use refresh token.
 */
export async function getAccessToken(
  userId: string,
  provider: Provider,
  refresh: Refresher,
  options: { rejectedToken?: string } = {},
): Promise<string> {
  const connection = await getConnection(userId, provider)
  if (!connection) throw new NotConnectedError(provider)
  if (connection.status === 'reauth_required') throw new ReauthRequiredError(provider)
  if (!options.rejectedToken && !isExpiring(connection)) {
    return decryptSecret(connection.accessToken)
  }

  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(connections)
        .where(eq(connections.id, connection.id))
        .for('update')
      if (!locked) throw new NotConnectedError(provider)

      const current = decryptSecret(locked.accessToken)
      const stale = options.rejectedToken ? current === options.rejectedToken : isExpiring(locked)
      if (!stale) return current // another caller refreshed while we waited for the lock
      if (!locked.refreshToken) throw new ReauthRequiredError(provider)

      const tokens = await refresh(decryptSecret(locked.refreshToken), locked)
      await tx
        .update(connections)
        .set({
          accessToken: encryptSecret(tokens.accessToken),
          accessTokenExpiresAt: tokens.expiresAt ?? null,
          ...(tokens.refreshToken !== undefined && {
            refreshToken: encryptSecret(tokens.refreshToken),
          }),
          ...(tokens.scope !== undefined && { scope: tokens.scope }),
        })
        .where(eq(connections.id, locked.id))
      return tokens.accessToken
    })
  } catch (error) {
    if (error instanceof ReauthRequiredError) await markReauthRequired(userId, provider)
    throw error
  }
}
