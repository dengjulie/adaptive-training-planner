import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'

export type SessionKind = 'easy' | 'long' | 'tempo' | 'intervals' | 'race' | 'rest'
export type Phase = 'base' | 'build' | 'peak' | 'taper'
export type RaceDistance = '5k' | '10k' | 'half' | 'marathon'

/** When the user can train on a weekday (0 = Monday), as "HH:MM" local times. */
export type TimeWindow = { weekday: number; start: string; end: string }

/** A race goal (server: plan/goal.ts, GoalSchema). */
export type GoalInput = {
  raceDistance: RaceDistance
  raceDate: string
  timeWindows: TimeWindow[]
  longRunWeekday: number
}

export type CorosBaseline = {
  weeklyMinutes: number
  weeklyKm: number
  runsPerWeek: number
  longestRunMinutes: number
  minutesPerKm: number | null
  weeks: { weekStart: string; minutes: number; km: number; runs: number }[]
}

export type PlanSession = {
  id: string
  day: string
  weekIndex: number
  phase: Phase
  /** As it stands today: the base session, or what the readiness rules changed it to. */
  kind: SessionKind
  minutes: number
  base: { kind: SessionKind; minutes: number }
  adjustment: { ruleId: string; reason: string; decidedOn: string } | null
  status: 'planned' | 'done' | 'missed'
  actualMinutes: number | null
  slotStatus: 'pending' | 'scheduled' | 'no_slot'
  startAt: string | null
  endAt: string | null
}

export type PlanWeek = {
  index: number
  start: string
  phase: Phase
  recovery: boolean
  targetMinutes: number
  plannedMinutes: number
  actualMinutes: number
}

export type CalendarSyncResult =
  | { status: 'synced'; updated: number; removed: number }
  | { status: 'not_connected' }
  | { status: 'failed'; message: string }

export type MorningResult = { done: number; missed: number; adjusted: number; calendar: CalendarSyncResult }

/** Everything the plan page shows (server: plan/service.ts, getPlanView). */
export type Plan = {
  today: string
  goal: GoalInput & { id: string; startDay: string }
  baseline: CorosBaseline | null
  weeks: PlanWeek[]
  sessions: PlanSession[]
  /** The last 14 days of Oura readiness and today's normal range; null without Oura data. */
  readiness: { days: { day: string; score: number | null }[]; range: { low: number; high: number } | null } | null
  calendar: { connected: boolean; syncedAt: string | null }
}

export function usePlan() {
  return useQuery({
    queryKey: ['plan'],
    queryFn: async () => (await api<{ plan: Plan | null }>('/api/plan')).plan,
  })
}

function usePlanMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan'] }),
  })
}

export const useCreateGoal = () =>
  usePlanMutation((goal: GoalInput) =>
    api<{ goalId: string; morning: MorningResult | null }>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(goal),
    }),
  )

export const useRunMorning = () =>
  usePlanMutation(() => api<MorningResult>('/api/plan/morning', { method: 'POST' }))

export const useMarkDone = () =>
  usePlanMutation((sessionId: string) => api(`/api/plan/sessions/${sessionId}/done`, { method: 'POST' }))

export const useCalendarSync = () =>
  usePlanMutation(() => api<CalendarSyncResult>('/api/plan/calendar-sync', { method: 'POST' }))
