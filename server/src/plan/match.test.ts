import { describe, expect, it } from 'vitest'
import { syntheticRuns } from '../../tests/fixtures/coros/synthetic.ts'
import { matchActivities, type MatchableSession } from './match.ts'

const TODAY = '2026-10-15'
const session = (id: string, day: string, minutes = 45, kind: MatchableSession['kind'] = 'easy'): MatchableSession => ({
  id,
  day,
  kind,
  minutes,
  status: 'planned',
})

describe('matchActivities', () => {
  // Runs on Mon/Tue/Thu; strength on Wed. 2026-10-12 is a Monday.
  const runs = syntheticRuns({
    start: '2026-10-12',
    end: TODAY,
    pattern: [
      { weekday: 0, minutes: 45, minutesPerKm: 6 },
      { weekday: 1, minutes: 90, minutesPerKm: 6 },
      { weekday: 3, minutes: 40, minutesPerKm: 6 },
    ],
    strengthWeekday: 2,
  })

  it('ticks off a session with a run of about the planned length on its day', () => {
    const [result] = matchActivities([session('mon', '2026-10-12')], runs, TODAY)
    expect(result).toMatchObject({ sessionId: 'mon', status: 'done', activityId: runs[0]!.labelId })
  })

  it('marks past sessions without a fitting run as missed', () => {
    const results = matchActivities(
      [session('tue', '2026-10-13', 40), session('wed', '2026-10-14', 45)],
      runs,
      TODAY,
    )
    // Tuesday's 90-minute run is too far from 40 minutes; Wednesday only has strength.
    expect(results).toEqual([
      { sessionId: 'tue', status: 'missed' },
      { sessionId: 'wed', status: 'missed' },
    ])
  })

  it("leaves today's session planned until a run shows up, and ignores future ones", () => {
    expect(matchActivities([session('fri', '2026-10-16')], runs, TODAY)).toEqual([])
    const withoutToday = runs.filter((run) => run.date !== TODAY)
    expect(matchActivities([session('thu', TODAY, 40)], withoutToday, TODAY)).toEqual([])
    expect(matchActivities([session('thu', TODAY, 40)], runs, TODAY)[0]).toMatchObject({ status: 'done' })
  })

  it('accepts a race of any length, and skips rest days and finished sessions', () => {
    const results = matchActivities(
      [
        session('race', '2026-10-13', 30, 'race'),
        session('rest', '2026-10-12', 0, 'rest'),
        { ...session('done', '2026-10-15', 40), status: 'done' },
      ],
      runs,
      TODAY,
    )
    expect(results).toEqual([expect.objectContaining({ sessionId: 'race', status: 'done' })])
  })
})
