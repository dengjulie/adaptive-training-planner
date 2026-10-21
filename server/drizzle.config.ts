import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

if (existsSync('../.env')) process.loadEnvFile('../.env')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL },
})
