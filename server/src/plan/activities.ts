import type { User } from '../db/schema.ts'
import type { CorosActivity } from '../integrations/coros/activities.ts'
import { fetchActivities, listTools, withCoros } from '../integrations/coros/client.ts'
import { getConnection } from '../lib/connections.ts'
import { addDays, type IsoDate } from '../lib/dates.ts'

/** querySportRecords returns at most 50 records, so long ranges are read two weeks at a time. */
const CHUNK_DAYS = 14

/**
 * COROS activities from `start` to `end`, or null when COROS isn't connected (or needs
 * reconnecting): the plan then works from defaults and manual "done" taps. Read live every time;
 * PRIVACY.md promises COROS workouts aren't stored.
 */
export async function loadActivities(
  user: User,
  start: IsoDate,
  end: IsoDate,
): Promise<CorosActivity[] | null> {
  const connection = await getConnection(user.id, 'coros')
  if (connection?.status !== 'active') return null

  return withCoros(user.id, async (client) => {
    const tools = await listTools(client)
    const byId = new Map<string, CorosActivity>()
    for (let from = start; from <= end; from = addDays(from, CHUNK_DAYS)) {
      const to = addDays(from, CHUNK_DAYS - 1) < end ? addDays(from, CHUNK_DAYS - 1) : end
      for (const activity of await fetchActivities(client, tools, from, to)) byId.set(activity.labelId, activity)
    }
    return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date))
  })
}

/** loadActivities, but a COROS outage leaves the plan as it is instead of failing the request. */
export async function loadActivitiesOrNull(...args: Parameters<typeof loadActivities>) {
  try {
    return await loadActivities(...args)
  } catch (error) {
    console.warn(`COROS activities unavailable: ${(error as Error).message}`)
    return null
  }
}
