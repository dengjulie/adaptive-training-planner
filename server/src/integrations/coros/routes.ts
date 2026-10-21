import { Hono } from 'hono'
import { saveConnection } from '../../lib/connections.ts'
import { randomToken } from '../../lib/crypto.ts'
import { addDays, todayIn } from '../../lib/dates.ts'
import {
  consumePendingAuthorization,
  OAuthCallbackError,
  redirectToApp,
  savePendingAuthorization,
} from '../../lib/oauth-state.ts'
import { requireSessionUser, type AppEnv } from '../../lib/session.ts'
import { fetchActivities, listTools, withCoros } from './client.ts'
import { completeCorosAuthorization, startCorosAuthorization } from './oauth.ts'

export const corosRoutes = new Hono<AppEnv>()
  .get('/auth/coros/start', async (c) => {
    await requireSessionUser(c)
    const state = randomToken()
    const { url, codeVerifier } = await startCorosAuthorization(state)
    await savePendingAuthorization(c, 'coros', { state, codeVerifier })
    return c.redirect(url)
  })

  .get('/auth/coros/callback', async (c) => {
    const user = await requireSessionUser(c)
    const pending = await consumePendingAuthorization(c, 'coros')
    const code = c.req.query('code')
    if (!code || !pending.codeVerifier) {
      throw new OAuthCallbackError('COROS did not return an authorization code.')
    }
    const { tokens, issuer } = await completeCorosAuthorization(
      code,
      pending.codeVerifier,
      c.req.query('iss'),
    )
    await saveConnection(user.id, 'coros', tokens, { metadata: issuer ? { issuer } : {} })
    return redirectToApp(c, { connected: 'coros' })
  })

  .get('/api/coros/overview', async (c) => {
    const user = c.get('user')
    const today = todayIn(user.timezone)
    return c.json(
      await withCoros(user.id, async (client) => {
        const tools = await listTools(client)
        return {
          activities: await fetchActivities(client, tools, addDays(today, -6), today),
          tools: tools.map(({ name, description }) => ({ name, description: description ?? null })),
        }
      }),
    )
  })
