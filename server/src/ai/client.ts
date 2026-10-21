import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.ts'

/** The AI features run only with an API key, so a server without one never calls out. */
export const aiEnabled = env.ANTHROPIC_API_KEY !== undefined
export const aiModel = env.ANTHROPIC_MODEL

let client: Anthropic | undefined

export function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client
}
