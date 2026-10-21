import { Hono } from 'hono'
import { z } from 'zod'
import { todayIn } from '../lib/dates.ts'
import type { AppEnv } from '../lib/session.ts'
import { GoalSchema, raceDateProblem } from './goal.ts'
import { createGoal, getActiveGoal, getPlanView, markSessionDone, runMorning, syncCalendar } from './service.ts'

export const planRoutes = new Hono<AppEnv>()
  .get('/api/plan', async (c) => c.json({ plan: await getPlanView(c.get('user')) }))

  // Creates a goal and its plan, replacing the current one.
  .post('/api/goals', async (c) => {
    const user = c.get('user')
    const parsed = GoalSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_goal', message: z.prettifyError(parsed.error) }, 400)
    }
    const problem = raceDateProblem(parsed.data.raceDate, todayIn(user.timezone))
    if (problem) return c.json({ error: 'invalid_goal', message: problem }, 400)
    return c.json(await createGoal(user, parsed.data), 201)
  })

  // The morning job for the signed-in user, on demand.
  .post('/api/plan/morning', async (c) => {
    const result = await runMorning(c.get('user'))
    if (!result) return c.json({ error: 'no_goal', message: 'Set a goal first.' }, 409)
    return c.json(result)
  })

  .post('/api/plan/sessions/:id/done', async (c) => {
    const id = c.req.param('id')
    if (!z.uuid().safeParse(id).success || !(await markSessionDone(c.get('user'), id))) {
      return c.json({ error: 'not_found', message: 'No such session.' }, 404)
    }
    return c.body(null, 204)
  })

  .post('/api/plan/calendar-sync', async (c) => {
    const user = c.get('user')
    const goal = await getActiveGoal(user.id)
    if (!goal) return c.json({ error: 'no_goal', message: 'Set a goal first.' }, 409)
    return c.json(await syncCalendar(user, goal))
  })
