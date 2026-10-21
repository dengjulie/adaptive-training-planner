import { describe, expect, it } from 'vitest'
import { syntheticOuraDays } from '../../tests/fixtures/oura/synthetic.ts'
import { trendDays } from '../integrations/oura/baseline.ts'
import { addDays } from '../lib/dates.ts'
import { adaptDay, applyAdjustments, RULES, type EffectiveSession } from './adapt.ts'

const TODAY = '2026-10-14' // a Wednesday

const trend = (lowDays: number) =>
  trendDays(syntheticOuraDays({ today: TODAY, lowDays }), addDays(TODAY, -6), TODAY)

const session = (id: string, day: string, kind: EffectiveSession['kind'], minutes: number): EffectiveSession => ({
  id,
  day,
  kind,
  minutes,
  status: 'planned',
})

const week = [
  session('mon', '2026-10-12', 'easy', 40),
  session('wed', TODAY, 'tempo', 45),
  session('fri', '2026-10-16', 'easy', 40),
  session('sun', '2026-10-18', 'long', 80),
  session('next-tue', '2026-10-20', 'intervals', 45),
]

describe('adaptDay', () => {
  it('changes nothing when readiness is in its normal range', () => {
    expect(adaptDay(TODAY, week, trend(0))).toEqual([])
  })

  it('turns a hard session into a shorter easy run when readiness is low', () => {
    const [adjustment, ...rest] = adaptDay(TODAY, week, trend(1))
    expect(rest).toEqual([])
    expect(adjustment).toMatchObject({ sessionId: 'wed', ruleId: RULES.lowReadiness, kind: 'easy', minutes: 30 })
    expect(adjustment!.reason).toMatch(/^Readiness \d+ is below your usual \d+–\d+, so today's tempo run is now an easy 30-minute run\.$/)
  })

  it('shortens the rest of the week after two low days, leaving next week alone', () => {
    const adjustments = adaptDay(TODAY, week, trend(2))
    expect(adjustments.map((a) => [a.sessionId, a.ruleId, a.kind, a.minutes])).toEqual([
      ['wed', RULES.lowReadiness, 'easy', 30],
      ['fri', RULES.lowReadinessStreak, 'easy', 30],
      ['sun', RULES.lowReadinessStreak, 'long', 65],
    ])
  })

  it('makes today a rest day when readiness is very low', () => {
    const days = trend(1)
    const today = days.at(-1)!
    today.readinessScore = 40
    const [adjustment] = adaptDay(TODAY, week, days)
    expect(adjustment).toMatchObject({ sessionId: 'wed', ruleId: RULES.veryLowReadiness, kind: 'rest', minutes: 0 })
  })

  it('never touches a race or a finished session', () => {
    const race = [session('race', TODAY, 'race', 120), { ...session('done', '2026-10-16', 'easy', 40), status: 'done' as const }]
    expect(adaptDay(TODAY, race, trend(2))).toEqual([])
  })

  it('changes nothing without a score or before there is a normal range', () => {
    const days = trend(1)
    days.at(-1)!.readinessScore = null
    expect(adaptDay(TODAY, week, days)).toEqual([])
    const short = trendDays(syntheticOuraDays({ today: TODAY, days: 10 }), addDays(TODAY, -2), TODAY)
    expect(adaptDay(TODAY, week, short)).toEqual([])
  })
})

describe('applyAdjustments', () => {
  it('overrides a session with its latest adjustment and leaves the rest alone', () => {
    const adjusted = applyAdjustments(week, [
      { sessionId: 'sun', kind: 'long', minutes: 65 },
      { sessionId: 'sun', kind: 'long', minutes: 60 },
    ])
    expect(adjusted.find((s) => s.id === 'sun')!.minutes).toBe(60)
    expect(adjusted.find((s) => s.id === 'fri')!.minutes).toBe(40)
  })
})
