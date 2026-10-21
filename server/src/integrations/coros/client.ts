import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type Tool,
} from '@modelcontextprotocol/client'
import { getAccessToken, markReauthRequired } from '../../lib/connections.ts'
import type { IsoDate } from '../../lib/dates.ts'
import { ReauthRequiredError, UpstreamError } from '../../lib/errors.ts'
import { parseSportRecords } from './activities.ts'
import { corosServerUrl, refreshCorosToken } from './oauth.ts'

/**
 * Runs `fn` with an MCP client connected to COROS as the user. Tokens come from the connection
 * store; on a 401 the transport asks for a refreshed token and retries once.
 */
export async function withCoros<T>(userId: string, fn: (client: Client) => Promise<T>) {
  let lastToken: string | undefined
  const authProvider: AuthProvider = {
    token: async () => (lastToken = await getAccessToken(userId, 'coros', refreshCorosToken)),
    onUnauthorized: async () => {
      lastToken = await getAccessToken(userId, 'coros', refreshCorosToken, {
        rejectedToken: lastToken,
      })
    },
  }

  const client = new Client({ name: 'train-smarter', version: '0.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(corosServerUrl, { authProvider }))
    return await fn(client)
  } catch (error) {
    // Still 401 after a refresh: the grant is gone and the user has to reconnect.
    if (error instanceof SdkHttpError && error.status === 401) {
      await markReauthRequired(userId, 'coros')
      throw new ReauthRequiredError('coros', error)
    }
    throw error
  } finally {
    await client.close().catch(() => {})
  }
}

export async function listTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

function placeholderFor(schema: unknown) {
  const { type, default: fallback } = (schema ?? {}) as { type?: string; default?: unknown }
  if (fallback !== undefined) return fallback
  if (type === 'number' || type === 'integer') return 0
  if (type === 'array') return []
  if (type === 'boolean') return false
  return ''
}

/**
 * Calls a COROS tool and returns its text output. COROS marks every input as required and rejects
 * unknown ones, so unset inputs get placeholders (their default, else "" or 0). Tool schemas have
 * changed before, so an argument the live schema no longer accepts is an error, not dropped.
 */
export async function callCorosTool(
  client: Client,
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new UpstreamError('coros', 502, `COROS no longer offers the ${name} tool`)

  const properties = tool.inputSchema.properties ?? {}
  const unknownArgs = Object.keys(args).filter((key) => !(key in properties))
  if (unknownArgs.length > 0) {
    throw new UpstreamError('coros', 502, `${name} no longer accepts ${unknownArgs.join(', ')}`)
  }
  const filled = { ...args }
  for (const key of tool.inputSchema.required ?? []) {
    if (!(key in filled)) filled[key] = placeholderFor(properties[key])
  }

  const result = await client.callTool({ name, arguments: filled })
  const text = result.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (result.isError) throw new UpstreamError('coros', 502, `${name} failed: ${text}`)
  return text
}

/** COROS dates are yyyyMMdd strings in the account's timezone. */
const corosDate = (day: IsoDate) => day.replaceAll('-', '')
const ALL_SPORTS = 65535

export async function fetchActivities(client: Client, tools: Tool[], start: IsoDate, end: IsoDate) {
  const text = await callCorosTool(client, tools, 'querySportRecords', {
    startDate: corosDate(start),
    endDate: corosDate(end),
    sportTypeCodes: [ALL_SPORTS],
    limit: 50,
  })
  return parseSportRecords(text)
}

export function getCorosActivities(userId: string, start: IsoDate, end: IsoDate) {
  return withCoros(userId, async (client) =>
    fetchActivities(client, await listTools(client), start, end),
  )
}
