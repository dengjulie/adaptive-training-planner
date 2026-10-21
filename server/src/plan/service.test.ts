import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { syntheticRuns } from '../../tests/fixtures/coros/synthetic.ts'
import { syntheticOuraDays } from '../../tests/fixtures/oura/synthetic.ts'
import { db, pool } from '../db/client.ts'
import { goals, ouraDaily, planAdjustments, plannedSessions, users, type User } from '../db/schema.ts'
import { ouraIntegration } from '../integrations/oura/index.ts'
import { addDays, todayIn, weekdayOf, type Weekday } from '../lib/dates.ts'
import { loadActivitiesOrNull } from './activities.ts'
import type { Goal } from './goal.ts'
import { createGoal, getPlanView, markSessionDone, runMorning } from './service.ts'

vi.mock('./activities.ts', () => ({ loadActivitiesOrNull: vi.fn() }))
vi.mock('../integrations/oura/oauth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../integrations/oura/oauth.ts')>()),
  revokeOuraAccess: vi.fn(),
}))

const TZ = 'UTC'
const today = todayIn(TZ)
const at = (offset: number) => ((weekdayOf(today) + offset) % 7) as Weekday
// Today is a training day, so the readiness rules have a session to change.
const trainingDays = [at(0), at(2), at(4), at(5)]

const goal = (): Goal => ({
  raceDistance: '10k',
  raceDate: addDays(today, 7 * 9),
  timeWindows: trainingDays.map((weekday) => ({ weekday, start: '06:00', end: '09:00' })),
  longRunWeekday: at(4),
})

const runs = (skip: string[] = []) =>
  syntheticRuns({
    start: addDays(today, -80),
    end: addDays(today, -1),
    pattern: trainingDays.map((weekday, i) => ({ weekday, minutes: i === 2 ? 70 : 45, minutesPerKm: 6 })),
    skip,
  })

let user: User

beforeEach(async () => {
  await db.delete(users)
  const [row] = await db.insert(users).values({ googleSub: 'plan-test', email: 'plan@example.invalid', timezone: TZ }).returning()
  user = row!
  vi.mocked(loadActivitiesOrNull).mockResolvedValue(runs())
})

afterAll(() => pool.end())

const adjustmentRows = () => db.select().from(planAdjustments).where(eq(planAdjustments.userId, user.id))
const lowReadiness = (lowDays: number) =>
  db.insert(ouraDaily).values(syntheticOuraDays({ today, lowDays }).map((d) => ({ ...d, userId: user.id })))

describe('createGoal', () => {
  it('builds the plan from the COROS baseline and schedules the next two weeks', async () => {
    await createGoal(user, goal())
    const view = await getPlanView(user)
    expect(view!.baseline!.runsPerWeek).toBe(4)
    expect(view!.weeks[0]!.targetMinutes).toBe(view!.baseline!.weeklyMinutes)
    const soon = view!.sessions.filter((s) => s.day < addDays(today, 14))
    expect(soon.length).toBeGreaterThan(0)
    expect(soon.every((s) => s.slotStatus === 'scheduled' && s.startAt !== null)).toBe(true)
    expect(view!.sessions.filter((s) => s.day >= addDays(today, 14)).every((s) => s.slotStatus === 'pending')).toBe(true)
  })

  it('works without COROS, from the starting defaults', async () => {
    vi.mocked(loadActivitiesOrNull).mockResolvedValue(null)
    await createGoal(user, goal())
    const view = await getPlanView(user)
    expect(view!.baseline).toBeNull()
    expect(view!.weeks[0]!.targetMinutes).toBe(90)
  })

  it('replaces the active goal, keeping its past sessions', async () => {
    await createGoal(user, goal(), { startDay: addDays(today, -10) })
    await createGoal(user, { ...goal(), raceDistance: 'half', raceDate: addDays(today, 7 * 12) })
    const rows = await db.select().from(goals).where(eq(goals.userId, user.id))
    expect(rows.map((g) => g.status).sort()).toEqual(['active', 'replaced'])
    const replaced = rows.find((g) => g.status === 'replaced')!
    const kept = await db.select().from(plannedSessions).where(eq(plannedSessions.goalId, replaced.id))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((s) => s.day < today)).toBe(true)

    // Earlier days of this week still show what happened under the old goal.
    const view = await getPlanView(user)
    const firstWeek = view!.weeks[0]!.start
    const carried = kept.filter((s) => s.day >= firstWeek)
    expect(view!.sessions.filter((s) => s.day < today).map((s) => s.id)).toEqual(carried.map((s) => s.id))
    expect(view!.sessions.filter((s) => s.day < today).every((s) => s.weekIndex === 0)).toBe(true)
  })
})

describe('runMorning', () => {
  it('ticks off past sessions with matching runs and marks the skipped one missed', async () => {
    const skipped = addDays(today, -7) // a training day: today's weekday, last week
    vi.mocked(loadActivitiesOrNull).mockResolvedValue(runs([skipped]))
    const { morning } = await createGoal(user, goal(), { startDay: addDays(today, -13) })
    const view = await getPlanView(user)
    const past = view!.sessions.filter((s) => s.day < today)
    expect(past.find((s) => s.day === skipped)!.status).toBe('missed')
    expect(past.filter((s) => s.day !== skipped).every((s) => s.status === 'done')).toBe(true)
    expect(morning).toMatchObject({ missed: 1, done: past.length - 1 })
  })

  it('applies the readiness rules as an overlay, the same however often it runs', async () => {
    await lowReadiness(2)
    await createGoal(user, goal())
    await runMorning(user)
    await runMorning(user)

    const view = await getPlanView(user)
    const todays = view!.sessions.find((s) => s.day === today)!
    expect(todays.adjustment?.ruleId).toBe('low-readiness')
    expect(todays.minutes).toBeLessThan(todays.base.minutes)
    // Each rule fired once per session, not once per run.
    const rows = await adjustmentRows()
    expect(new Set(rows.map((r) => r.sessionId)).size).toBe(rows.length)
    // The base plan itself is untouched.
    const [base] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, todays.id))
    expect(base!.baseMinutes).toBe(todays.base.minutes)
  })

  it('changes nothing with readiness in range', async () => {
    await lowReadiness(0)
    await createGoal(user, goal())
    expect(await adjustmentRows()).toEqual([])
  })

  it('returns null without a goal', async () => {
    expect(await runMorning(user)).toBeNull()
  })
})

describe('disconnecting Oura', () => {
  it('deletes the overlay, so sessions fall back to the base plan', async () => {
    await lowReadiness(1)
    await createGoal(user, goal())
    expect((await adjustmentRows()).length).toBeGreaterThan(0)

    await ouraIntegration.disconnect(user.id)
    expect(await adjustmentRows()).toEqual([])
    const view = await getPlanView(user)
    const todays = view!.sessions.find((s) => s.day === today)!
    expect(todays.adjustment).toBeNull()
    expect(todays.minutes).toBe(todays.base.minutes)
    expect(view!.readiness).toBeNull()
  })
})

describe('markSessionDone', () => {
  it("marks the user's own session done, and nobody else's", async () => {
    await createGoal(user, goal())
    const view = await getPlanView(user)
    const session = view!.sessions[0]!
    expect(await markSessionDone({ ...user, id: '00000000-0000-0000-0000-000000000000' }, session.id)).toBe(false)
    expect(await markSessionDone(user, session.id)).toBe(true)
    expect((await getPlanView(user))!.sessions[0]!.status).toBe('done')
  })
})
