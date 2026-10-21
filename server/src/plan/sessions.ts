/**
 * Vocabulary shared by the plan modules. Nothing here depends on Oura, so the AI code may use it.
 */

/** `rest` only comes from an adjustment: the base plan leaves rest days empty. */
export const SESSION_KINDS = ['easy', 'long', 'tempo', 'intervals', 'race', 'rest'] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

export const PHASES = ['base', 'build', 'peak', 'taper'] as const
export type Phase = (typeof PHASES)[number]

export const SESSION_STATUSES = ['planned', 'done', 'missed'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

/** Sessions that need a fresh body, so two never fall on consecutive days. */
export function isHard(kind: SessionKind) {
  return kind === 'tempo' || kind === 'intervals' || kind === 'long' || kind === 'race'
}

const TITLES: Record<SessionKind, string> = {
  easy: 'Easy run',
  long: 'Long run',
  tempo: 'Tempo run',
  intervals: 'Intervals',
  race: 'Race',
  rest: 'Rest',
}

/** "Easy run · 40 min", as the calendar and the plan page show a session. */
export function sessionTitle(kind: SessionKind, minutes: number) {
  return kind === 'rest' || kind === 'race' ? TITLES[kind] : `${TITLES[kind]} · ${minutes} min`
}

/** Minutes rounded to the nearest 5, as plans are written. */
export const roundMinutes = (minutes: number) => Math.round(minutes / 5) * 5
