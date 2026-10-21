import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { appOrigin, env } from '../env.ts'
import { OAuthCallbackError } from '../lib/oauth-state.ts'
import { startSession, type AppEnv } from '../lib/session.ts'
import { DEMO_GOOGLE_SUB } from './demo.ts'

/** Signs in as the demo user. Only exists with DEMO_MODE on (never in production; see env.ts). */
export const demoRoutes = new Hono<AppEnv>().get('/auth/demo', async (c) => {
  if (!env.DEMO_MODE) return c.notFound()
  const [user] = await db.select().from(users).where(eq(users.googleSub, DEMO_GOOGLE_SUB))
  if (!user) throw new OAuthCallbackError('No demo account yet: run npm run db:seed:demo first.')
  await startSession(c, user.id)
  return c.redirect(new URL('/', appOrigin).toString())
})
