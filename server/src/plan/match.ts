import type { CorosActivity } from '../integrations/coros/activities.ts'
import type { IsoDate } from '../lib/dates.ts'
import { isRun } from './baseline.ts'
import type { SessionKind, SessionStatus } from './sessions.ts'

/** How far a run's duration may be from the planned minutes and still count as the session. */
export const DURATION_TOLERANCE = 0.4

export type MatchableSession = {
  id: string
  day: IsoDate
  kind: SessionKind
  minutes: number
  status: SessionStatus
}

export type MatchResult =
  | { sessionId: string; status: 'done'; activityId: string; actualMinutes: number }
  | { sessionId: string; status: 'missed' }

/**
 * Ticks off planned sessions with the COROS runs that match them (README, "Match activities to
 * planned sessions"): a run on the same day, within 40% of the planned minutes (any length for
 * a race). Each run counts once, the closest in length first. Sessions before `today` that no run
 * matches are missed; today's stay planned, since the run may still happen. Rest days are skipped.
 */
export function matchActivities(
  sessions: MatchableSession[],
  activities: CorosActivity[],
  today: IsoDate,
): MatchResult[] {
  const used = new Set<string>()
  const results: MatchResult[] = []
  const runs = activities.filter((a) => isRun(a) && a.durationSeconds !== null)

  for (const session of [...sessions].sort((a, b) => a.day.localeCompare(b.day))) {
    if (session.status !== 'planned' || session.kind === 'rest' || session.day > today) continue
    const fits = (minutes: number) =>
      session.kind === 'race' || Math.abs(minutes - session.minutes) <= session.minutes * DURATION_TOLERANCE
    const match = runs
      .filter((run) => run.date === session.day && !used.has(run.labelId))
      .map((run) => ({ run, minutes: run.durationSeconds! / 60 }))
      .filter(({ minutes }) => fits(minutes))
      .sort((a, b) => Math.abs(a.minutes - session.minutes) - Math.abs(b.minutes - session.minutes))[0]

    if (match) {
      used.add(match.run.labelId)
      results.push({
        sessionId: session.id,
        status: 'done',
        activityId: match.run.labelId,
        actualMinutes: Math.round(match.minutes),
      })
    } else if (session.day < today) {
      results.push({ sessionId: session.id, status: 'missed' })
    }
  }
  return results
}
