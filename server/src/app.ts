import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { demoRoutes } from './demo/routes.ts'
import { appOrigin, isProduction } from './env.ts'
import { corosRoutes } from './integrations/coros/routes.ts'
import { googleRoutes } from './integrations/google/routes.ts'
import { ouraRoutes } from './integrations/oura/routes.ts'
import {
  IntegrationError,
  NotConfiguredError,
  NotConnectedError,
  ReauthRequiredError,
  UpstreamError,
} from './lib/errors.ts'
import { OAuthCallbackError, redirectToApp } from './lib/oauth-state.ts'
import { requireUser, type AppEnv } from './lib/session.ts'
import { planRoutes } from './plan/routes.ts'
import { aiRoutes } from './routes/ai.ts'
import { meRoutes } from './routes/me.ts'

export const app = new Hono<AppEnv>()

app.use(logger())
app.use(secureHeaders())
app.use(csrf({ origin: appOrigin }))

app.get('/api/health', (c) => c.json({ ok: true }))
app.use('/api/*', requireUser)

app.route('/', meRoutes)
app.route('/', googleRoutes)
app.route('/', ouraRoutes)
app.route('/', corosRoutes)
app.route('/', planRoutes)
app.route('/', aiRoutes)
app.route('/', demoRoutes)

if (isProduction) {
  // Serve the built web app and fall back to index.html for client-side routes.
  const webDist = path.resolve(import.meta.dirname, '../../web/dist')
  app.use('/*', serveStatic({ root: webDist }))
  app.get('*', serveStatic({ path: path.join(webDist, 'index.html') }))
}

app.onError((error, c) => {
  // OAuth redirects land on /auth/*: send the browser back to the app with a readable error.
  if (c.req.method === 'GET' && c.req.path.startsWith('/auth/')) {
    if (!(error instanceof OAuthCallbackError)) console.error(error)
    const provider = error instanceof IntegrationError ? error.provider : undefined
    return redirectToApp(c, { error: error.message, provider })
  }

  if (error instanceof HTTPException) return error.getResponse()
  if (error instanceof NotConnectedError) {
    return c.json({ error: 'not_connected', provider: error.provider, message: error.message }, 409)
  }
  if (error instanceof ReauthRequiredError) {
    return c.json(
      { error: 'reauth_required', provider: error.provider, message: error.message },
      409,
    )
  }
  if (error instanceof NotConfiguredError) {
    return c.json({ error: 'not_configured', provider: error.provider, message: error.message }, 503)
  }
  if (error instanceof UpstreamError) {
    console.error(error)
    return c.json({ error: 'upstream_error', provider: error.provider, message: error.message }, 502)
  }
  console.error(error)
  return c.json({ error: 'internal_error', message: 'Something went wrong.' }, 500)
})
