import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { providerEnum, type Provider } from '../db/schema.ts'
import { corosIntegration } from '../integrations/coros/index.ts'
import { googleIntegration } from '../integrations/google/index.ts'
import { ouraIntegration } from '../integrations/oura/index.ts'
import type { Integration } from '../integrations/types.ts'
import { listConnections } from '../lib/connections.ts'
import { endSession, type AppEnv } from '../lib/session.ts'

const integrations: Record<Provider, Integration> = {
  google: googleIntegration,
  oura: ouraIntegration,
  coros: corosIntegration,
}

export const meRoutes = new Hono<AppEnv>()
  .get('/api/me', async (c) => {
    const user = c.get('user')
    const rows = await listConnections(user.id)
    return c.json({
      user: { id: user.id, email: user.email, timezone: user.timezone },
      integrations: Object.values(integrations).map(({ provider, label, configured }) => {
        const connection = rows.find((row) => row.provider === provider)
        return {
          provider,
          label,
          configured,
          connected: connection !== undefined,
          status: connection?.status ?? null,
          connectedAt: connection?.createdAt ?? null,
        }
      }),
    })
  })
  .delete('/api/connections/:provider', async (c) => {
    const provider = c.req.param('provider')
    if (!providerEnum.enumValues.includes(provider as Provider)) {
      throw new HTTPException(404, { message: `Unknown provider: ${provider}` })
    }
    await integrations[provider as Provider].disconnect(c.get('user').id)
    return c.body(null, 204)
  })
  .post('/auth/logout', async (c) => {
    await endSession(c)
    return c.body(null, 204)
  })
