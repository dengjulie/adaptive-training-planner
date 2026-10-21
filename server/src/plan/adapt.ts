/**
 * The readiness rules (README, "Daily adaptation job"). This is the one plan module that reads
 * Oura data, so everything it returns is Oura-derived: it is stored apart from the base plan
 * (plan_adjustments), explained by fixed templates here, and never reaches an AI model. Code in
 * src/ai/ must not import this file (src/ai/boundary.test.ts checks).
 *
 * The rules use Oura's own readiness score against the user's normal range; they don't recreate
 * the score.
 */
import type { OuraTrendDay } from '../integrations/oura/baseline.ts'
import { addDays, startOfWeek, type IsoDate } from '../lib/dates.ts'
import { roundMinutes, type SessionKind, type SessionStatus } from './sessions.ts'

export type EffectiveSession = {
  id: string
  day: IsoDate
  kind: SessionKind
  minutes: number
  status: SessionStatus
}

export const RULES = {
  lowReadiness: 'low-readiness',
  veryLowReadiness: 'very-low-readiness',
  lowReadinessStreak: 'low-readiness-streak',
} as const
export type RuleId = (typeof RULES)[keyof typeof RULES]

export type Adjustment = {
  sessionId: string
  ruleId: RuleId
  kind: SessionKind
  minutes: number
  reason: string
}

/** Share of a session's minutes left after each rule. */
const LOW_READINESS_SHARE: Partial<Record<SessionKind, number>> = {
  tempo: 0.7,
  intervals: 0.7,
  long: 0.75,
  easy: 0.8,
}
const STREAK_SHARE = 0.8
const MIN_MINUTES = 20

type Readiness = { score: number; low: number; high: number; mean: number }

function readinessOn(days: OuraTrendDay[], day: IsoDate): Readiness | null {
  const entry = days.find((d) => d.day === day)
  const range = entry?.normalRange.readinessScore
  if (!entry || entry.readinessScore === null || !range) return null
  return { score: entry.readinessScore, ...range }
}

const isLow = (r: Readiness | null): r is Readiness => r !== null && r.score < r.low
/** Two standard deviations under the mean: low enough to take the day off. */
const isVeryLow = (r: Readiness) => r.score < r.mean - 2 * (r.mean - r.low)

const range = (r: Readiness) => `${Math.round(r.low)}–${Math.round(r.high)}`
const NAMES: Record<SessionKind, string> = {
  easy: 'easy run',
  long: 'long run',
  tempo: 'tempo run',
  intervals: 'interval session',
  race: 'race',
  rest: 'rest day',
}

/** Today's session under low readiness, or null when it stays as it is. */
function lowReadinessAdjustment(session: EffectiveSession, r: Readiness): Adjustment | null {
  if (session.kind === 'race' || session.kind === 'rest') return null
  if (isVeryLow(r)) {
    return {
      sessionId: session.id,
      ruleId: RULES.veryLowReadiness,
      kind: 'rest',
      minutes: 0,
      reason: `Readiness ${r.score} is well below your usual ${range(r)}, so today's ${NAMES[session.kind]} is now a rest day.`,
    }
  }
  const share = LOW_READINESS_SHARE[session.kind]!
  const minutes = Math.max(MIN_MINUTES, roundMinutes(session.minutes * share))
  const kind: SessionKind = session.kind === 'tempo' || session.kind === 'intervals' ? 'easy' : session.kind
  const what = kind === session.kind ? `${minutes} minutes` : `an easy ${minutes}-minute run`
  return {
    sessionId: session.id,
    ruleId: RULES.lowReadiness,
    kind,
    minutes,
    reason: `Readiness ${r.score} is below your usual ${range(r)}, so today's ${NAMES[session.kind]} is now ${what}.`,
  }
}

/**
 * The adjustments for the morning of `today`, given the sessions as they stand before them
 * (base plan plus earlier days' adjustments) and the Oura trend around today.
 *
 * - Readiness below its normal range: today's session gets easier (a hard one becomes an easy
 *   run); well below it, today becomes a rest day.
 * - Below the range two days running: the rest of the week is 20% shorter.
 *
 * Races are never changed. With no score or no normal range yet (under 14 days of history),
 * nothing changes.
 */
export function adaptDay(
  today: IsoDate,
  sessions: EffectiveSession[],
  ouraDays: OuraTrendDay[],
): Adjustment[] {
  const todays = readinessOn(ouraDays, today)
  if (!isLow(todays)) return []
  const adjustments: Adjustment[] = []

  for (const session of sessions) {
    if (session.day !== today || session.status !== 'planned') continue
    const adjustment = lowReadinessAdjustment(session, todays)
    if (adjustment) adjustments.push(adjustment)
  }

  if (isLow(readinessOn(ouraDays, addDays(today, -1)))) {
    const weekEnd = addDays(startOfWeek(today), 6)
    for (const session of sessions) {
      if (session.day <= today || session.day > weekEnd || session.status !== 'planned') continue
      if (session.kind === 'race' || session.kind === 'rest') continue
      adjustments.push({
        sessionId: session.id,
        ruleId: RULES.lowReadinessStreak,
        kind: session.kind,
        minutes: Math.max(MIN_MINUTES, roundMinutes(session.minutes * STREAK_SHARE)),
        reason: `Readiness has been below your usual ${range(todays)} two days running, so the rest of this week is 20% shorter.`,
      })
    }
  }
  return adjustments
}

/** A session as adjusted: the base, overridden by its latest adjustment if it has one. */
export function applyAdjustments<S extends EffectiveSession>(
  sessions: S[],
  adjustments: { sessionId: string; kind: SessionKind; minutes: number }[],
): S[] {
  const latest = new Map(adjustments.map((a) => [a.sessionId, a]))
  return sessions.map((s) => {
    const adjustment = latest.get(s.id)
    return adjustment ? { ...s, kind: adjustment.kind, minutes: adjustment.minutes } : s
  })
}
