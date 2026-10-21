import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { TEST_DATABASE_URL } from './database-url.ts'

/** Creates the test database on first run and applies migrations before the suite. */
export default async function setup() {
  const testUrl = new URL(TEST_DATABASE_URL)
  const name = decodeURIComponent(testUrl.pathname.slice(1))
  const adminUrl = new URL(testUrl)
  adminUrl.pathname = '/postgres'

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  const existing = await admin.query('select 1 from pg_database where datname = $1', [name])
  if (existing.rowCount === 0) await admin.query(`create database "${name.replaceAll('"', '""')}"`)
  await admin.end()

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL })
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle'),
  })
  await pool.end()
}
