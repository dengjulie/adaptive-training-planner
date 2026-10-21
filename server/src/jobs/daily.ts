/**
 * Morning job (README, "Daily adaptation job"). Schedule it once a day after the user usually
 * wakes and their ring and watch have synced, e.g. with cron:
 *
 *   30 6 * * *  cd /path/to/train-smarter && npm run job:daily
 *
 * `npm run job:daily -- --user <email>` runs it for one user only. In development, point it at the
 * demo user: without --user it syncs every account's real Oura data.
 *
 * It syncs Oura and applies Oura retention, then runs the plan's morning steps (plan/service.ts:
 * match runs, schedule, readiness rules, calendar). The morning note is still to come.
 */
import { parseArgs } from 'node:util'
import { and, eq } from 'drizzle-orm'
import { db, pool } from '../db/client.ts'
import { connections, users, type Provider, type User } from '../db/schema.ts'
import { purgeExpiredOuraData, syncOura } from '../integrations/oura/sync.ts'
import { runMorning } from '../plan/service.ts'

async function activeProviders(userId: string) {
  const rows = await db
    .select({ provider: connections.provider })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.status, 'active')))
  return new Set<Provider>(rows.map((row) => row.provider))
}

async function runForUser(user: User): Promise<boolean> {
  const log = (message: string) => console.log(`[daily] ${user.email}: ${message}`)
  const providers = await activeProviders(user.id)
  let ok = true

  if (providers.has('oura')) {
    try {
      // A few days back, to pick up nights that synced late. Logs name collections, never values.
      const { days, missing, failed } = await syncOura(user, { windowDays: 3 })
      log(`oura synced ${days} days`)
      if (missing.length > 0) log(`oura scopes not granted for: ${missing.join(', ')}`)
      if (failed.length > 0) {
        ok = false
        log(`oura collections failed: ${failed.join(', ')}`)
      }
    } catch (error) {
      ok = false
      log(`oura sync failed: ${(error as Error).message}`)
    }
  }
  await purgeExpiredOuraData(user)

  try {
    // Counts only: adjustments quote readiness values, which stay out of logs.
    const morning = await runMorning(user)
    if (morning) {
      log(
        `plan: ${morning.done} done, ${morning.missed} missed, ${morning.adjusted} adjusted, calendar ${morning.calendar.status}`,
      )
      if (morning.calendar.status === 'failed') ok = false
    }
  } catch (error) {
    ok = false
    log(`plan update failed: ${(error as Error).message}`)
  }

  return ok
}

const { values: args } = parseArgs({ options: { user: { type: 'string' } } })
const allUsers = await db
  .select()
  .from(users)
  .where(args.user ? eq(users.email, args.user) : undefined)
if (args.user && allUsers.length === 0) {
  console.error(`[daily] no user with email ${args.user}`)
  process.exitCode = 1
}
let failures = 0
for (const user of allUsers) {
  if (!(await runForUser(user))) failures++
}
await pool.end()
console.log(`[daily] done: ${allUsers.length} user(s), ${failures} with failures`)
if (failures > 0) process.exitCode = 1
