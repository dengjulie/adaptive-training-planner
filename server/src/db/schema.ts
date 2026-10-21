import { sql } from 'drizzle-orm'
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
import type { CorosBaseline } from '../plan/baseline.ts'
import type { PlanWeek } from '../plan/generate.ts'
import type { TimeWindow } from '../plan/goal.ts'
import { RACE_DISTANCES } from '../plan/goal.ts'
import { PHASES, SESSION_KINDS, SESSION_STATUSES } from '../plan/sessions.ts'

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

export const raceDistanceEnum = pgEnum('race_distance', RACE_DISTANCES)
export const goalStatusEnum = pgEnum('goal_status', ['active', 'replaced'])
export const sessionKindEnum = pgEnum('session_kind', SESSION_KINDS)
export const planPhaseEnum = pgEnum('plan_phase', PHASES)
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES)
export const slotStatusEnum = pgEnum('slot_status', ['pending', 'scheduled', 'no_slot'])

/** A race goal and the plan built for it. A user has at most one active goal. */
export const goals = pgTable(
  'goals',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: goalStatusEnum().notNull().default('active'),
    raceDistance: raceDistanceEnum().notNull(),
    raceDate: date({ mode: 'string' }).notNull(),
    // When the user can train: one window per training weekday (0 = Monday), local time.
    timeWindows: jsonb().$type<TimeWindow[]>().notNull(),
    longRunWeekday: integer().notNull(),
    // The first day of the plan and its weeks, as plan/generate.ts built them.
    startDay: date({ mode: 'string' }).notNull(),
    weeks: jsonb().$type<PlanWeek[]>().notNull(),
    // Weekly running volume from COROS the plan started from (aggregates, not workouts); null
    // when COROS wasn't connected.
    baseline: jsonb().$type<CorosBaseline>(),
    calendarSyncedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.userId).where(sql`${t.status} = 'active'`)],
)

/**
 * The base plan: sessions as the goal, COROS history, and calendar made them. Nothing in these
 * rows comes from Oura; readiness changes live in plan_adjustments.
 */
export const plannedSessions = pgTable(
  'planned_sessions',
  {
    // Also the Training calendar event's trainSmarterSessionId.
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    weekIndex: integer().notNull(),
    phase: planPhaseEnum().notNull(),
    baseKind: sessionKindEnum().notNull(),
    baseMinutes: integer().notNull(),
    status: sessionStatusEnum().notNull().default('planned'),
    // The COROS activity that completed the session and how long it took; null for a manual tap.
    activityId: text(),
    actualMinutes: integer(),
    slotStatus: slotStatusEnum().notNull().default('pending'),
    startAt: timestamp({ withTimezone: true }),
    endAt: timestamp({ withTimezone: true }),
    // SHA-256 of what the calendar event last showed, so unchanged events aren't rewritten. The
    // event shows the adjusted session, so treat this like plan_adjustments: never AI input.
    calendarEventHash: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId, t.day), index().on(t.goalId)],
)

/**
 * The Oura overlay: what the readiness rules (plan/adapt.ts) changed. Oura-derived, so it follows
 * Oura data: purged with the retention window, deleted when Oura is disconnected (sessions then
 * fall back to their base), and never sent to an AI model or written to the calendar as text.
 */
export const planAdjustments = pgTable(
  'plan_adjustments',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid()
      .notNull()
      .references(() => plannedSessions.id, { onDelete: 'cascade' }),
    // The morning the rule fired. Re-running a morning replaces its rows.
    decidedOn: date({ mode: 'string' }).notNull(),
    ruleId: text().notNull(),
    kind: sessionKindEnum().notNull(),
    minutes: integer().notNull(),
    // From a fixed template; it quotes readiness values.
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.decidedOn), index().on(t.sessionId)],
)

export type User = typeof users.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Provider = (typeof providerEnum.enumValues)[number]
export type OuraDaily = typeof ouraDaily.$inferSelect
export type OuraRecord = typeof ouraRecords.$inferSelect
export type GoalRow = typeof goals.$inferSelect
export type PlannedSession = typeof plannedSessions.$inferSelect
export type PlanAdjustment = typeof planAdjustments.$inferSelect
