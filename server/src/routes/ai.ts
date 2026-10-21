/**
 * HTTP for the AI features. The client sends only the conversation; the COROS summary is built
 * here, so nothing else can ride along into the model request. Like src/ai/, this file must not
 * reach Oura code (src/ai/boundary.test.ts walks its imports too).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { aiEnabled, aiModel, anthropic } from '../ai/client.ts'
import { IntakeMessageSchema, runGoalIntake } from '../ai/goalIntake.ts'
import { todayIn } from '../lib/dates.ts'
import type { AppEnv } from '../lib/session.ts'
import { loadActivitiesOrNull } from '../plan/activities.ts'
import { baselineStart, corosBaseline } from '../plan/baseline.ts'

const IntakeRequestSchema = z.object({
  messages: z
    .array(IntakeMessageSchema)
    .min(1)
    .max(20)
    .refine((messages) => messages[0]?.role === 'user' && messages.at(-1)?.role === 'user', {
      message: 'The conversation starts and ends with the runner',
    }),
})

export const aiRoutes = new Hono<AppEnv>().post('/api/ai/goal-intake', async (c) => {
  if (!aiEnabled) {
    return c.json({ error: 'not_configured', message: 'AI goal intake is off (no ANTHROPIC_API_KEY).' }, 503)
  }
  const parsed = IntakeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', message: z.prettifyError(parsed.error) }, 400)
  }
  const user = c.get('user')
  const today = todayIn(user.timezone)
  const activities = await loadActivitiesOrNull(user, baselineStart(today), today)
  const baseline = activities ? corosBaseline(activities, today) : null
  const coros = baseline && {
    weeklyMinutes: baseline.weeklyMinutes,
    weeklyKm: baseline.weeklyKm,
    runsPerWeek: baseline.runsPerWeek,
    longestRunMinutes: baseline.longestRunMinutes,
    minutesPerKm: baseline.minutesPerKm,
  }
  return c.json(await runGoalIntake(anthropic(), aiModel, { today, coros, messages: parsed.data.messages }))
})
