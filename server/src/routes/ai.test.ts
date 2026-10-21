/**
 * The Oura data boundary, checked on the wire: with Oura data and readiness adjustments stored
 * for the user, the request the goal intake sends to Anthropic carries none of it. Canary values
 * are planted so a leak can't hide among ordinary numbers.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { syntheticRuns } from '../../tests/fixtures/coros/synthetic.ts'
import { syntheticOuraDays } from '../../tests/fixtures/oura/synthetic.ts'
import { anthropic } from '../ai/client.ts'
import { emptyDraft } from '../ai/goalIntake.ts'
import { app } from '../app.ts'
import { db, pool } from '../db/client.ts'
import { ouraDaily, planAdjustments, sessions, users, type User } from '../db/schema.ts'
import { appOrigin } from '../env.ts'
import { randomToken, sha256 } from '../lib/crypto.ts'
import { addDays, todayIn, weekdayOf, type Weekday } from '../lib/dates.ts'
import { loadActivitiesOrNull } from '../plan/activities.ts'
import { createGoal } from '../plan/service.ts'

const parse = vi.fn()
vi.mock('../ai/client.ts', () => ({
  aiEnabled: true,
  aiModel: 'test-model',
  anthropic: vi.fn(),
}))
vi.mock('../plan/activities.ts', () => ({ loadActivitiesOrNull: vi.fn() }))

const CANARY_HRV = 987.65
const today = todayIn('UTC')
const at = (offset: number) => ((weekdayOf(today) + offset) % 7) as Weekday

let user: User
let cookie: string

beforeEach(async () => {
  await db.delete(users)
  const [row] = await db
    .insert(users)
    .values({ googleSub: 'ai-test', email: 'ai@example.invalid', timezone: 'UTC' })
    .returning()
  user = row!
  const token = randomToken()
  await db.insert(sessions).values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) })
  cookie = `ts_session=${token}`

  const trainingDays = [at(0), at(2), at(4), at(5)]
  vi.mocked(loadActivitiesOrNull).mockResolvedValue(
    syntheticRuns({
      start: addDays(today, -80),
      end: addDays(today, -1),
      pattern: trainingDays.map((weekday) => ({ weekday, minutes: 50, minutesPerKm: 6 })),
    }),
  )
  vi.mocked(anthropic).mockReturnValue({ beta: { messages: { parse } } } as never)
  parse.mockReset().mockResolvedValue({
    stop_reason: 'end_turn',
    parsed_output: { reply: 'Which race are you training for?', draft: emptyDraft, complete: false },
  })
})

afterAll(() => pool.end())

const intake = (messages: unknown) =>
  app.request('/api/ai/goal-intake', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })

describe('POST /api/ai/goal-intake', () => {
  it('sends Anthropic the conversation and COROS volume, and nothing from Oura', async () => {
    // Oura data with a canary HRV, low readiness today, and a plan the readiness rules changed.
    await db.insert(ouraDaily).values(
      syntheticOuraDays({ today, lowDays: 1 }).map((d) => ({ ...d, averageHrv: CANARY_HRV, userId: user.id })),
    )
    await createGoal(user, {
      raceDistance: '10k',
      raceDate: addDays(today, 7 * 8),
      timeWindows: [at(0), at(2), at(4), at(5)].map((weekday) => ({ weekday, start: '06:00', end: '09:00' })),
      longRunWeekday: at(4),
    })
    const adjustments = await db.select().from(planAdjustments).where(eq(planAdjustments.userId, user.id))
    expect(adjustments.length).toBeGreaterThan(0) // the overlay exists, so a leak would be possible

    const response = await intake([{ role: 'user', content: 'I want to run a fast 10K this winter' }])
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reply: 'Which race are you training for?', goal: null })

    expect(parse).toHaveBeenCalledOnce()
    const request = JSON.stringify(parse.mock.calls[0]![0])
    // What should be there: the runner's words and their COROS volume.
    expect(request).toContain('I want to run a fast 10K this winter')
    expect(request).toMatch(/about \d+ minutes \([\d.]+ km\) of running a week over 4 runs/)
    // What must not: any Oura value, word, or readiness-driven change.
    expect(request).not.toContain(String(CANARY_HRV))
    expect(request.toLowerCase()).not.toMatch(/readiness|oura|hrv|resting heart/)
    for (const adjustment of adjustments) {
      expect(request).not.toContain(adjustment.reason)
      expect(request).not.toContain(adjustment.sessionId)
    }
  })

  it('returns a complete draft as a goal the form can use', async () => {
    const draft = {
      raceDistance: 'half',
      raceDate: addDays(today, 7 * 12),
      timeWindows: [1, 3, 6].map((weekday) => ({ weekday, start: '06:30', end: '08:00' })),
      longRunWeekday: 6,
    }
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { reply: 'Half marathon, three days a week. Check the form.', draft, complete: true },
    })
    const response = await intake([{ role: 'user', content: 'Half marathon in 12 weeks, Tue Thu Sun mornings' }])
    expect(await response.json()).toMatchObject({ goal: draft, problem: null })
  })

  it('flags a complete draft that breaks the goal rules instead of passing it on', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: {
        reply: 'Got it.',
        draft: { raceDistance: '5k', raceDate: addDays(today, 7), timeWindows: [{ weekday: 1, start: '06:30', end: '08:00' }], longRunWeekday: 3 },
        complete: true,
      },
    })
    const response = await intake([{ role: 'user', content: '5K next week, Tuesdays' }])
    const body = (await response.json()) as { goal: unknown; problem: string | null }
    expect(body.goal).toBeNull()
    expect(body.problem).toMatch(/at least two days|long run/)
  })

  it('falls back to the form when the model declines', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null })
    const body = await (await intake([{ role: 'user', content: 'hello' }])).json()
    expect(body).toMatchObject({ goal: null, draft: emptyDraft })
  })

  it('accepts only a conversation that starts and ends with the runner', async () => {
    expect((await intake([{ role: 'assistant', content: 'Hi' }])).status).toBe(400)
    expect((await intake([{ role: 'user', content: 'x', extra: 'readiness 40' }])).status).toBe(200)
    // Unknown fields are dropped, not forwarded.
    expect(JSON.stringify(parse.mock.calls.at(-1)![0])).not.toContain('readiness 40')
  })
})
