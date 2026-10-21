import { z } from 'zod'

const base64Key32 = z
  .string()
  .refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    'must be 32 random bytes, base64-encoded (generate with: openssl rand -base64 32)',
  )

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  // Public origin of the web app. OAuth redirect URIs and post-login redirects are built from it.
  // In development this is the Vite dev server, which proxies /api and /auth to this server.
  APP_URL: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -base64 32)'),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  // Optional comma-separated list of Google account emails allowed to sign in.
  ALLOWED_EMAILS: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),

  OURA_CLIENT_ID: z.string().optional(),
  OURA_CLIENT_SECRET: z.string().optional(),
  OURA_REDIRECT_URI: z.url().optional(),

  // Regional endpoint for the COROS account: mcpus (Americas), mcpeu (Europe), mcpcn (China).
  // The mcp.coros.com gateway advertises mcpus as its resource, which MCP clients reject.
  COROS_MCP_URL: z.url().default('https://mcpus.coros.com/mcp'),
  COROS_REDIRECT_URI: z.url().optional(),

  // Development only: enables /auth/demo and synthetic COROS runs for the demo user that
  // `npm run db:seed:demo` creates, so the app can be tried without real accounts or data.
  DEMO_MODE: z.stringbool().default(false),
})

function loadEnv() {
  // `KEY=` in .env yields an empty string; treat that as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
  const result = EnvSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration (see .env.example):\n${z.prettifyError(result.error)}`,
    )
  }
  if (result.data.DEMO_MODE && result.data.NODE_ENV === 'production') {
    throw new Error('DEMO_MODE signs anyone in as the demo user; it must be off in production.')
  }
  return result.data
}

export const env = loadEnv()

export const appOrigin = new URL(env.APP_URL).origin
export const isProduction = env.NODE_ENV === 'production'
export const secureCookies = appOrigin.startsWith('https://')

export const allowedEmails = new Set(
  (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
)

function oauthClient(clientId?: string, clientSecret?: string, redirectUri?: string) {
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null
}

export const googleOAuth = oauthClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI ?? `${appOrigin}/auth/google/callback`,
)

export const ouraOAuth = oauthClient(
  env.OURA_CLIENT_ID,
  env.OURA_CLIENT_SECRET,
  env.OURA_REDIRECT_URI ?? `${appOrigin}/auth/oura/callback`,
)

export const corosConfig = {
  mcpUrl: env.COROS_MCP_URL,
  redirectUri: env.COROS_REDIRECT_URI ?? `${appOrigin}/auth/coros/callback`,
}
