/**
 * Conversational goal intake (README, "Where AI is used"): Claude turns what the runner says into
 * a draft goal, asking follow-up questions until it has every field. The draft only fills in the
 * goal form; the runner reviews it and creates the plan themselves.
 *
 * Data boundary: the only inputs are the conversation, today's date, and COROS training volume.
 * Nothing from Oura, and nothing derived from it (readiness changes to the plan included), may
 * reach this module (CLAUDE.md, the Oura API agreement). boundary.test.ts checks the imports and
 * canary.test.ts checks the request itself, so keep GoalIntakeInput this narrow.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { IsoDate } from '../lib/dates.ts'
import type { CorosBaseline } from '../plan/baseline.ts'
import { GoalSchema, RACE_DISTANCES, raceDateProblem, type Goal } from '../plan/goal.ts'

export const IntakeMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2000),
})
export type IntakeMessage = z.infer<typeof IntakeMessageSchema>

/** The COROS figures the intake may see: weekly volume, nothing per workout. */
export type CorosSummary = Pick<
  CorosBaseline,
  'weeklyMinutes' | 'weeklyKm' | 'runsPerWeek' | 'longestRunMinutes' | 'minutesPerKm'
>

export type GoalIntakeInput = {
  today: IsoDate
  coros: CorosSummary | null
  messages: IntakeMessage[]
}

const DraftSchema = z.object({
  raceDistance: z
    .enum(RACE_DISTANCES)
    .nullable()
    .describe('The race: 5k, 10k, half (half marathon), or marathon. Null until the runner says.'),
  raceDate: z.string().nullable().describe('Race day as YYYY-MM-DD. Null until the runner says.'),
  timeWindows: z
    .array(
      z.object({
        weekday: z.number().int().describe('0 = Monday, 1 = Tuesday, … 6 = Sunday'),
        start: z.string().describe('Earliest start, HH:MM in 24-hour time'),
        end: z.string().describe('Latest finish, HH:MM in 24-hour time'),
      }),
    )
    .describe('The days the runner can train, one entry per day, with the time window that day'),
  longRunWeekday: z
    .number()
    .int()
    .nullable()
    .describe('Weekday for the long run (0 = Monday … 6 = Sunday); one of the training days'),
})
export type GoalDraft = z.infer<typeof DraftSchema>

const ReplySchema = z.object({
  reply: z
    .string()
    .describe('Your next message to the runner: one short follow-up question, or a one-line summary once complete'),
  draft: DraftSchema,
  complete: z.boolean().describe('True once every draft field comes from what the runner said'),
})

const SYSTEM = `You help a runner set up a race goal for a training planner. Over a short chat, find out:
- which race: 5K, 10K, half marathon, or marathon
- the race date
- which days of the week they can run, and the time window on each of those days
- which of those days suits the long run

Ask about whatever is still missing, one short question at a time, in plain friendly language. When they're vague ("weekday mornings", "early"), turn that into concrete days and times and say what you assumed in your reply. Weekend long runs are a sensible default to suggest. Don't give training advice or build the plan: the planner does that from the goal.

Return the draft with every field filled so far (null or empty for what's unknown), even mid-conversation. Set complete to true once every field is filled, and then reply with a one-line summary and ask them to check the form.`

const describeCoros = (coros: CorosSummary | null) =>
  coros
    ? `Their COROS history, last 4 weeks: about ${coros.weeklyMinutes} minutes (${coros.weeklyKm} km) of running a week over ${coros.runsPerWeek} runs; longest run in 8 weeks ${coros.longestRunMinutes} minutes${coros.minutesPerKm ? `; average pace ${coros.minutesPerKm} min/km` : ''}. Use it to sanity-check the goal (for example, mention it if a marathon in six weeks looks like a big jump), but the planner sets the volume.`
    : 'No COROS history is connected.'

export const emptyDraft: GoalDraft = { raceDistance: null, raceDate: null, timeWindows: [], longRunWeekday: null }

export type GoalIntakeResult = {
  reply: string
  draft: GoalDraft
  /** The draft as a valid goal, once it is complete and passes the same checks as the form. */
  goal: Goal | null
  /** Why a complete draft isn't a valid goal yet; the form shows the same problem on submit. */
  problem: string | null
}

/** One turn of the intake: the conversation so far in, Claude's reply and the updated draft out. */
export async function runGoalIntake(
  client: Anthropic,
  model: string,
  input: GoalIntakeInput,
): Promise<GoalIntakeResult> {
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    // Chat-sized turns: low effort answers quickly and does well here.
    output_config: { effort: 'low', format: betaZodOutputFormat(ReplySchema) },
    // If the model declines on policy grounds, the server retries on its default fallback.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: `Today is ${input.today}. ${describeCoros(input.coros)}` },
    ],
    messages: input.messages,
  })

  const parsed = response.parsed_output
  if (response.stop_reason === 'refusal' || !parsed) {
    return {
      reply: 'Sorry, I couldn’t work that out. You can fill in the form below directly.',
      draft: emptyDraft,
      goal: null,
      problem: null,
    }
  }
  if (!parsed.complete) return { reply: parsed.reply, draft: parsed.draft, goal: null, problem: null }

  const goal = GoalSchema.safeParse(parsed.draft)
  if (!goal.success) {
    return { reply: parsed.reply, draft: parsed.draft, goal: null, problem: z.prettifyError(goal.error) }
  }
  return {
    reply: parsed.reply,
    draft: parsed.draft,
    goal: goal.data,
    problem: raceDateProblem(goal.data.raceDate, input.today),
  }
}
