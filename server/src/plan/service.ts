/**
 * The planner's I/O: goals and sessions in the database, COROS activities, the Oura readiness
 * rules, and the Training calendar. The pure parts live next to it (generate, schedule, adapt,
 * match). This module reads Oura data (through adapt.ts), so src/ai/ must not import it.
 */
import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { db, type Db, type Transaction } from '../db/client.ts'
import {
  goals,
  planAdjustments,
  plannedSessions,
  type GoalRow,
  type PlanAdjustment,
  type PlannedSession,
  type User,
} from '../db/schema.ts'
import { appOrigin } from '../env.ts'
import {
  deleteSessionEvent,
  ensureTrainingCalendar,
  getBusyTimes,
  upsertSessionEvent,
} from '../integrations/google/calendar.ts'
import { trendDays } from '../integrations/oura/baseline.ts'
import { getStoredOuraDays } from '../integrations/oura/sync.ts'
import { getConnection } from '../lib/connections.ts'
import { sha256 } from '../lib/crypto.ts'
import { addDays, todayIn, zonedInstant, type IsoDate } from '../lib/dates.ts'
import { loadActivitiesOrNull } from './activities.ts'
import { adaptDay, applyAdjustments, type EffectiveSession } from './adapt.ts'
import { baselineStart, corosBaseline } from './baseline.ts'
import { generatePlan } from './generate.ts'
import type { Goal } from './goal.ts'
import { matchActivities } from './match.ts'
import { placeSessions, type Interval } from './schedule.ts'
import { sessionTitle, type SessionKind } from './sessions.ts'

/** Days ahead, today included, that get time slots and calendar events. */
export const HORIZON_DAYS = 14
/** How far back the morning run looks for COROS runs to tick off sessions. */
const MATCH_LOOKBACK_DAYS = 14

const RACE_LABELS: Record<Goal['raceDistance'], string> = {
  '5k': '5K',
  '10k': '10K',
  half: 'Half marathon',
  marathon: 'Marathon',
}

export async function getActiveGoal(userId: string): Promise<GoalRow | undefined> {
  const [goal] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
  return goal
}

type Executor = Db | Transaction

async function sessionsOf(goalId: string, executor: Executor = db) {
  return executor
    .select()
    .from(plannedSessions)
    .where(eq(plannedSessions.goalId, goalId))
    .orderBy(asc(plannedSessions.day))
}

/** A goal's adjustments, oldest first, so the latest wins in applyAdjustments. */
async function adjustmentsOf(goalId: string, executor: Executor = db): Promise<PlanAdjustment[]> {
  const rows = await executor
    .select({ adjustment: planAdjustments })
    .from(planAdjustments)
    .innerJoin(plannedSessions, eq(planAdjustments.sessionId, plannedSessions.id))
    .where(eq(plannedSessions.goalId, goalId))
    .orderBy(asc(planAdjustments.decidedOn), asc(planAdjustments.createdAt))
  return rows.map((row) => row.adjustment)
}

const asEffective = (session: PlannedSession): EffectiveSession & { row: PlannedSession } => ({
  id: session.id,
  day: session.day,
  kind: session.baseKind,
  minutes: session.baseMinutes,
  status: session.status,
  row: session,
})

/**
 * Sessions as they stand today: the base plan with the Oura overlay applied. Inside a
 * transaction, pass it, so the read sees the transaction's own writes.
 */
async function effectiveSessionsOf(goalId: string, executor: Executor = db) {
  const sessions = await sessionsOf(goalId, executor)
  const adjustments = await adjustmentsOf(goalId, executor)
  return { sessions: applyAdjustments(sessions.map(asEffective), adjustments), adjustments }
}

export type CalendarSyncResult =
  | { status: 'synced'; updated: number; removed: number }
  | { status: 'not_connected' }
  | { status: 'failed'; message: string }

async function hasGoogle(userId: string) {
  return (await getConnection(userId, 'google'))?.status === 'active'
}

/** Busy time on the primary calendar from the start of `from` to the end of `to`. */
async function busyBetween(user: User, from: IsoDate, to: IsoDate): Promise<Interval[]> {
  if (!(await hasGoogle(user.id))) return []
  try {
    const blocks = await getBusyTimes(
      user.id,
      zonedInstant(from, '00:00', user.timezone),
      zonedInstant(addDays(to, 1), '00:00', user.timezone),
    )
    return blocks.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
  } catch (error) {
    console.warn(`free/busy unavailable: ${(error as Error).message}`)
    return []
  }
}

/**
 * Creates a goal and its plan, replacing the active one (whose sessions from today on are
 * deleted, past ones kept as history), then runs the morning steps so today is current.
 * `startDay` defaults to today; the demo seed starts plans in the past.
 */
export async function createGoal(user: User, goal: Goal, { startDay }: { startDay?: IsoDate } = {}) {
  const today = todayIn(user.timezone)
  const start = startDay ?? today
  const activities = await loadActivitiesOrNull(user, baselineStart(start), today)
  const baseline = activities ? corosBaseline(activities, start) : null
  const plan = generatePlan(goal, baseline, start)

  const { goal: created, removedEvents } = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.userId, user.id), eq(goals.status, 'active')))
      .for('update')
    let removedEvents: string[] = []
    if (previous) {
      const deleted = await tx
        .delete(plannedSessions)
        .where(and(eq(plannedSessions.goalId, previous.id), gte(plannedSessions.day, today)))
        .returning({ id: plannedSessions.id, calendarEventHash: plannedSessions.calendarEventHash })
      removedEvents = deleted.filter((s) => s.calendarEventHash).map((s) => s.id)
      await tx.update(goals).set({ status: 'replaced' }).where(eq(goals.id, previous.id))
    }
    const [row] = await tx
      .insert(goals)
      .values({ ...goal, userId: user.id, startDay: start, weeks: plan.weeks, baseline })
      .returning()
    if (plan.sessions.length > 0) {
      await tx.insert(plannedSessions).values(
        plan.sessions.map((s) => ({
          userId: user.id,
          goalId: row!.id,
          day: s.day,
          weekIndex: s.weekIndex,
          phase: s.phase,
          baseKind: s.kind,
          baseMinutes: s.minutes,
        })),
      )
    }
    return { goal: row!, removedEvents }
  })

  if (removedEvents.length > 0 && (await hasGoogle(user.id))) {
    try {
      const calendar = await ensureTrainingCalendar(user.id)
      for (const id of removedEvents) await deleteSessionEvent(user, calendar.id!, id)
    } catch (error) {
      console.warn(`couldn't remove the old plan's events: ${(error as Error).message}`)
    }
  }
  const morning = await runMorning(user, today, activities)
  return { goalId: created.id, morning }
}

/** Ticks off sessions with COROS runs and marks past unmatched ones missed. */
async function matchRecent(goal: GoalRow, today: IsoDate, activities: Awaited<ReturnType<typeof loadActivitiesOrNull>>) {
  if (!activities) return { done: 0, missed: 0 }
  const { sessions } = await effectiveSessionsOf(goal.id)
  const from = addDays(today, -MATCH_LOOKBACK_DAYS)
  const results = matchActivities(sessions.filter((s) => s.day >= from), activities, today)
  await db.transaction(async (tx) => {
    for (const result of results) {
      await tx
        .update(plannedSessions)
        .set(
          result.status === 'done'
            ? { status: 'done', activityId: result.activityId, actualMinutes: result.actualMinutes }
            : { status: 'missed' },
        )
        .where(eq(plannedSessions.id, result.sessionId))
    }
  })
  return {
    done: results.filter((r) => r.status === 'done').length,
    missed: results.filter((r) => r.status === 'missed').length,
  }
}

/** Gives the next HORIZON_DAYS of planned sessions a free slot, moving days where needed. */
async function scheduleHorizon(user: User, goal: GoalRow, today: IsoDate) {
  const horizonEnd = addDays(today, HORIZON_DAYS - 1)
  const sessions = await sessionsOf(goal.id)
  const inHorizon = (s: PlannedSession) => s.status === 'planned' && s.day >= today && s.day <= horizonEnd
  const toPlace = sessions.filter(inHorizon)
  const others = sessions.filter((s) => !inHorizon(s)).map((s) => ({ id: s.id, day: s.day, kind: s.baseKind }))
  const busy = await busyBetween(user, today, horizonEnd)

  const placements = placeSessions(
    toPlace.map((s) => ({ id: s.id, day: s.day, kind: s.baseKind, minutes: s.baseMinutes })),
    goal.timeWindows,
    busy,
    user.timezone,
    today,
    others,
  )
  await db.transaction(async (tx) => {
    for (const { id, day, slot } of placements) {
      await tx
        .update(plannedSessions)
        .set({
          day,
          slotStatus: slot ? 'scheduled' : 'no_slot',
          startAt: slot?.start ?? null,
          endAt: slot?.end ?? null,
        })
        .where(eq(plannedSessions.id, id))
    }
  })
}

/** Applies the readiness rules for `today`, replacing whatever an earlier run that day decided. */
async function adaptMorning(user: User, goal: GoalRow, today: IsoDate) {
  const stored = await getStoredOuraDays(user.id)
  return db.transaction(async (tx) => {
    await tx
      .delete(planAdjustments)
      .where(and(eq(planAdjustments.userId, user.id), eq(planAdjustments.decidedOn, today)))
    if (stored.length === 0) return []
    const { sessions } = await effectiveSessionsOf(goal.id, tx)
    const adjustments = adaptDay(
      today,
      sessions.filter((s) => s.day >= today),
      trendDays(stored, addDays(today, -1), today),
    )
    if (adjustments.length > 0) {
      await tx
        .insert(planAdjustments)
        .values(adjustments.map((a) => ({ ...a, userId: user.id, decidedOn: today })))
    }
    return adjustments
  })
}

/** What a session's calendar event should show, or null when it shouldn't have one. */
function desiredEvent(session: EffectiveSession & { row: PlannedSession }, goal: GoalRow) {
  const { row } = session
  if (!row.startAt || session.status === 'missed' || session.kind === 'rest') return null
  const summary =
    session.kind === 'race' ? `${sessionTitle('race', 0)} · ${RACE_LABELS[goal.raceDistance]}` : sessionTitle(session.kind, session.minutes)
  const end = new Date(row.startAt.getTime() + Math.max(session.minutes, 1) * 60_000)
  return {
    summary,
    // No readiness values or reasons here: the calendar only shows the session.
    description: `Planned by Train Smarter. Details: ${appOrigin}/`,
    start: row.startAt.toISOString(),
    end: end.toISOString(),
  }
}

/**
 * Brings the Training calendar in line with the next HORIZON_DAYS of sessions: creates or
 * updates events whose content changed, and removes events of sessions that lost their slot.
 */
export async function syncCalendar(user: User, goal: GoalRow, today = todayIn(user.timezone)): Promise<CalendarSyncResult> {
  if (!(await hasGoogle(user.id))) return { status: 'not_connected' }
  try {
    const calendar = await ensureTrainingCalendar(user.id)
    const horizonEnd = addDays(today, HORIZON_DAYS - 1)
    const { sessions } = await effectiveSessionsOf(goal.id)
    let updated = 0
    let removed = 0
    for (const session of sessions) {
      const { row } = session
      if (session.day < today || (session.day > horizonEnd && !row.calendarEventHash)) continue
      const event = session.day <= horizonEnd ? desiredEvent(session, goal) : null
      const hash = event ? sha256(JSON.stringify(event)) : null
      if (hash === row.calendarEventHash) continue
      if (event) {
        await upsertSessionEvent(user, calendar.id!, { sessionId: row.id, ...event })
        updated++
      } else {
        await deleteSessionEvent(user, calendar.id!, row.id)
        removed++
      }
      await db.update(plannedSessions).set({ calendarEventHash: hash }).where(eq(plannedSessions.id, row.id))
    }
    await db.update(goals).set({ calendarSyncedAt: new Date() }).where(eq(goals.id, goal.id))
    return { status: 'synced', updated, removed }
  } catch (error) {
    console.error(error)
    return { status: 'failed', message: (error as Error).message }
  }
}

export type MorningResult = {
  done: number
  missed: number
  adjusted: number
  calendar: CalendarSyncResult
}

/**
 * The morning steps (README, "Daily adaptation job"): tick off yesterday's runs, give the next two
 * weeks free slots, apply the readiness rules, and update the calendar. Safe to run again: each
 * step replaces what an earlier run the same day did. `activities` skips a second COROS read when
 * the caller already has them.
 */
export async function runMorning(
  user: User,
  today = todayIn(user.timezone),
  activities?: Awaited<ReturnType<typeof loadActivitiesOrNull>>,
): Promise<MorningResult | null> {
  const goal = await getActiveGoal(user.id)
  if (!goal) return null
  const recent =
    activities !== undefined
      ? activities
      : await loadActivitiesOrNull(user, addDays(today, -MATCH_LOOKBACK_DAYS), today)
  const matched = await matchRecent(goal, today, recent)
  await scheduleHorizon(user, goal, today)
  const adjustments = await adaptMorning(user, goal, today)
  const calendar = await syncCalendar(user, goal, today)
  return { ...matched, adjusted: adjustments.length, calendar }
}

/** The manual "done" tap, for runs COROS didn't record. */
export async function markSessionDone(user: User, sessionId: string) {
  const [row] = await db
    .update(plannedSessions)
    .set({ status: 'done', activityId: null, actualMinutes: null })
    .where(and(eq(plannedSessions.id, sessionId), eq(plannedSessions.userId, user.id)))
    .returning({ id: plannedSessions.id })
  return row !== undefined
}

/**
 * Sessions of replaced goals in the plan's first week, before it started: what the user did (or
 * missed) earlier that week still belongs in the week's picture. Shown as part of week 0.
 */
async function carriedOverSessions(goal: GoalRow) {
  const firstWeek = goal.weeks[0]
  if (!firstWeek || firstWeek.start >= goal.startDay) return { sessions: [], adjustments: [] }
  const rows = await db
    .select()
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, goal.userId),
        ne(plannedSessions.goalId, goal.id),
        gte(plannedSessions.day, firstWeek.start),
        lt(plannedSessions.day, goal.startDay),
      ),
    )
    .orderBy(asc(plannedSessions.day))
  if (rows.length === 0) return { sessions: [], adjustments: [] }
  const adjustments = await db
    .select()
    .from(planAdjustments)
    .where(inArray(planAdjustments.sessionId, rows.map((r) => r.id)))
    .orderBy(asc(planAdjustments.decidedOn), asc(planAdjustments.createdAt))
  const sessions = rows.map((row) => asEffective({ ...row, weekIndex: 0, phase: firstWeek.phase }))
  return { sessions: applyAdjustments(sessions, adjustments), adjustments }
}

export type SessionView = {
  id: string
  day: IsoDate
  weekIndex: number
  phase: PlannedSession['phase']
  kind: SessionKind
  minutes: number
  base: { kind: SessionKind; minutes: number }
  adjustment: { ruleId: string; reason: string; decidedOn: IsoDate } | null
  status: PlannedSession['status']
  actualMinutes: number | null
  slotStatus: PlannedSession['slotStatus']
  startAt: string | null
  endAt: string | null
}

/** Everything the plan page shows, or null without an active goal. */
export async function getPlanView(user: User) {
  const goal = await getActiveGoal(user.id)
  if (!goal) return null
  const today = todayIn(user.timezone)
  const [current, earlier, stored, google] = await Promise.all([
    effectiveSessionsOf(goal.id),
    carriedOverSessions(goal),
    getStoredOuraDays(user.id),
    hasGoogle(user.id),
  ])
  const sessions = [...earlier.sessions, ...current.sessions]
  const latest = new Map([...earlier.adjustments, ...current.adjustments].map((a) => [a.sessionId, a]))

  const sessionViews: SessionView[] = sessions.map((s) => {
    const adjustment = latest.get(s.id)
    const end = s.row.startAt ? new Date(s.row.startAt.getTime() + s.minutes * 60_000) : null
    return {
      id: s.id,
      day: s.day,
      weekIndex: s.row.weekIndex,
      phase: s.row.phase,
      kind: s.kind,
      minutes: s.minutes,
      base: { kind: s.row.baseKind, minutes: s.row.baseMinutes },
      adjustment: adjustment
        ? { ruleId: adjustment.ruleId, reason: adjustment.reason, decidedOn: adjustment.decidedOn }
        : null,
      status: s.status,
      actualMinutes: s.row.actualMinutes,
      slotStatus: s.row.slotStatus,
      startAt: s.row.startAt?.toISOString() ?? null,
      endAt: end?.toISOString() ?? null,
    }
  })

  const weeks = goal.weeks.map((week) => {
    const inWeek = sessionViews.filter((s) => s.weekIndex === week.index && s.kind !== 'race')
    return {
      ...week,
      plannedMinutes: inWeek.reduce((sum, s) => sum + s.minutes, 0),
      actualMinutes: inWeek
        .filter((s) => s.status === 'done')
        .reduce((sum, s) => sum + (s.actualMinutes ?? s.minutes), 0),
    }
  })

  const readinessDays = trendDays(stored, addDays(today, -13), today)
  const todayRange = readinessDays.at(-1)?.normalRange.readinessScore ?? null
  return {
    today,
    goal: {
      id: goal.id,
      raceDistance: goal.raceDistance,
      raceDate: goal.raceDate,
      timeWindows: goal.timeWindows,
      longRunWeekday: goal.longRunWeekday,
      startDay: goal.startDay,
    },
    baseline: goal.baseline,
    weeks,
    sessions: sessionViews,
    readiness: stored.length
      ? {
          days: readinessDays.map((d) => ({ day: d.day, score: d.readinessScore })),
          range: todayRange && { low: todayRange.low, high: todayRange.high },
        }
      : null,
    calendar: { connected: google, syncedAt: goal.calendarSyncedAt?.toISOString() ?? null },
  }
}

export type PlanView = NonNullable<Awaited<ReturnType<typeof getPlanView>>>
