import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  googleSub: text().notNull().unique(),
  email: text().notNull(),
  // IANA zone used to decide what "today" and "this morning" mean for the user.
  timezone: text().notNull().default('UTC'),
  // The dedicated Google calendar the app writes sessions to. Kept on the user (not the Google
  // connection) so reconnecting Google reuses it instead of creating a second "Training" calendar.
  trainingCalendarId: text(),
  ...timestamps,
})

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 of the cookie token, so a database leak doesn't leak live sessions.
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
)

export const providerEnum = pgEnum('provider', ['google', 'oura', 'coros'])
export const connectionStatusEnum = pgEnum('connection_status', ['active', 'reauth_required'])

export type ConnectionMetadata = {
  /** Oura, COROS: the authorization server that issued the tokens; refreshes go back to it. */
  issuer?: string
  /** Oura: collections the last sync couldn't read because the user didn't grant their scope. */
  ouraMissingCollections?: string[]
  /** Oura: when a sync last covered the whole retention window. Reconnecting clears it. */
  ouraBackfilledAt?: string
}

export const connections = pgTable(
  'connections',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: providerEnum().notNull(),
    status: connectionStatusEnum().notNull().default('active'),
    externalAccountId: text(),
    scope: text(),
    // OAuth tokens are encrypted at rest (see lib/crypto.ts).
    accessToken: text().notNull(),
    refreshToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    metadata: jsonb().$type<ConnectionMetadata>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.userId, t.provider)],
)

/**
 * OAuth clients the app registered with an authorization server through dynamic client
 * registration (COROS). Registrations are bound to a redirect URI, so changing APP_URL
 * registers a new client instead of reusing one that would fail after login.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    issuer: text().notNull(),
    redirectUri: text().notNull(),
    // Encrypted JSON of the registration response (client_id, and client_secret if any).
    clientInformation: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.issuer, t.redirectUri] })],
)

/**
 * One row per user per day from Oura: the values the baseline and adaptation rules read,
 * derived from oura_records during sync and kept for the same retention window.
 */
export const ouraDaily = pgTable(
  'oura_daily',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The day the user woke up.
    day: date({ mode: 'string' }).notNull(),
    readinessScore: integer(),
    // From the night's long sleep: average HRV (ms) and lowest heart rate (bpm).
    averageHrv: real(),
    restingHeartRate: integer(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)

/** An Oura API document, as Oura sent it. */
export type OuraDocument = Record<string, unknown>

/**
 * Everything the Oura API returns, one row per document, stored as sent so every field is kept.
 * Time series (heart rate, ring battery) have no documents, so their samples are stored one row
 * per local day. Kept for the Oura retention window (see integrations/oura/sync.ts).
 */
export const ouraRecords = pgTable(
  'oura_records',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The API collection, e.g. daily_readiness or heartrate.
    collection: text().notNull(),
    // Oura's document id; for time series, the day.
    recordId: text().notNull(),
    // The day the record belongs to. Null for profile and ring records, which have no day.
    day: date({ mode: 'string' }),
    data: jsonb().$type<OuraDocument>().notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.collection, t.recordId] }), index().on(t.userId, t.day)],
)

export type User = typeof users.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Provider = (typeof providerEnum.enumValues)[number]
export type OuraDaily = typeof ouraDaily.$inferSelect
export type OuraRecord = typeof ouraRecords.$inferSelect
