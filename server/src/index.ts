import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { pool } from './db/client.ts'
import { env } from './env.ts'

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (app: ${env.APP_URL})`)
})

function shutdown() {
  server.close()
  void pool.end()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
