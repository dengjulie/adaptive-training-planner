/**
 * Creates the demo user, replacing any earlier one, with synthetic data only:
 * - 60 days of Oura readiness, HRV, and resting heart rate, the last two below their normal range;
 * - a half-marathon plan that started two weeks ago, ticked off against synthetic COROS runs
 *   (one missed), with today's readiness rules applied.
 *
 *   createdb train_smarter_demo
 *   DATABASE_URL=postgresql://localhost:5432/train_smarter_demo DEMO_MODE=true npm run db:seed:demo
 *
 * Then start the app with the same two variables and open /auth/demo. Re-run it to reset the demo
 * to today. It refuses databases whose name doesn't end in _demo, so it can't touch real data.
 */
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { syntheticOuraDays } from '../../tests/fixtures/oura/synthetic.ts'
import { db, pool } from '../db/client.ts'
import { ouraDaily, users } from '../db/schema.ts'
import { DEMO_EMAIL, DEMO_GOOGLE_SUB, demoTrainingPattern } from '../demo/demo.ts'
import { env } from '../env.ts'
import { addDays, todayIn, weekdayOf } from '../lib/dates.ts'
import { createGoal } from '../plan/service.ts'

const database = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1))
if (!database.endsWith('_demo')) {
  throw new Error(`Refusing to seed "${database}": point DATABASE_URL at a database ending in _demo.`)
}
if (!env.DEMO_MODE) throw new Error("Set DEMO_MODE=true: the demo user's runs only exist with it on.")

await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle') })

const timezone = process.env.DEMO_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
await db.delete(users).where(eq(users.googleSub, DEMO_GOOGLE_SUB))
const [user] = await db
  .insert(users)
  .values({ googleSub: DEMO_GOOGLE_SUB, email: DEMO_EMAIL, timezone })
  .returning()
if (!user) throw new Error('Could not create the demo user')

const today = todayIn(timezone)
await db
  .insert(ouraDaily)
  .values(syntheticOuraDays({ today, lowDays: 2 }).map((day) => ({ ...day, userId: user.id })))

const pattern = demoTrainingPattern(today)
let raceDate = addDays(today, 70)
while (weekdayOf(raceDate) !== pattern.longRunWeekday) raceDate = addDays(raceDate, 1)
const weekend = (weekday: number) => weekday >= 5
const { morning } = await createGoal(
  user,
  {
    raceDistance: 'half',
    raceDate,
    timeWindows: pattern.trainingDays.map((weekday) => ({
      weekday,
      start: weekend(weekday) ? '08:00' : '06:30',
      end: weekend(weekday) ? '11:00' : '08:30',
    })),
    longRunWeekday: pattern.longRunWeekday,
  },
  { startDay: addDays(today, -14) },
)

console.log(
  `Demo user ${DEMO_EMAIL} (${timezone}): half marathon on ${raceDate}; ` +
    `${morning?.done} sessions done, ${morning?.missed} missed, ${morning?.adjusted} adjusted today.`,
)
await pool.end()
