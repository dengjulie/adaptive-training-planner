// Data from the Oura API must never be sent to an LLM (Oura API agreement §4(d)). Readiness-based
// decisions stay in deterministic code; an LLM that needs Oura data must use Oura's MCP server.
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { getAccessToken, markReauthRequired } from '../../lib/connections.ts'
import { addDays, type IsoDate } from '../../lib/dates.ts'
import { MissingScopeError, ReauthRequiredError, UpstreamError } from '../../lib/errors.ts'
import type { OuraCollection } from './collections.ts'
import { refreshOuraToken } from './oauth.ts'

const API_BASE = 'https://api.ouraring.com'

/** Oura has rejected longer time-series ranges, so samples are requested in pieces this long. */
const MAX_SAMPLE_RANGE_MS = 30 * 24 * 60 * 60 * 1000

/** Waiting longer than this for the rate limit to reset isn't worth holding a request open. */
const MAX_RATE_LIMIT_WAIT_MS = 30_000

async function errorDetail(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  const detail = body?.detail
  return typeof detail === 'string' ? detail : JSON.stringify(detail ?? response.statusText)
}

/** How long a 429 asks us to wait, or null when that's too long to wait inline. */
function rateLimitWaitMs(response: Response): number | null {
  const retryAfterMs = Number(response.headers.get('Retry-After')) * 1000
  const resetMs = Number(response.headers.get('X-RateLimit-Reset')) * 1000 - Date.now()
  const wait = retryAfterMs > 0 ? retryAfterMs : resetMs > 0 ? resetMs : 5000
  return wait <= MAX_RATE_LIMIT_WAIT_MS ? wait : null
}

async function ouraGet(userId: string, path: string, params: Record<string, string>) {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const send = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })

  const token = await getAccessToken(userId, 'oura', refreshOuraToken)
  let response = await send(token)
  if (response.status === 401) {
    const detail = await errorDetail(response)
    // Oura also answers 401 for a missing scope. Refreshing can't fix that, and each refresh
    // spends the single-use refresh token, so only refresh for other 401s.
    if (/scope/i.test(detail)) throw new MissingScopeError('oura', detail)
    response = await send(
      await getAccessToken(userId, 'oura', refreshOuraToken, { rejectedToken: token }),
    )
  }
  if (response.status === 429) {
    // A year-long backfill makes many requests; wait out a short rate limit once.
    const wait = rateLimitWaitMs(response)
    if (wait !== null) {
      await sleep(wait)
      response = await send(await getAccessToken(userId, 'oura', refreshOuraToken))
    }
  }
  if (response.ok) return (await response.json()) as unknown

  const detail = await errorDetail(response)
  if (response.status === 401) {
    await markReauthRequired(userId, 'oura')
    throw new ReauthRequiredError('oura', detail)
  }
  if (response.status === 403) {
    throw new UpstreamError(
      'oura',
      403,
      'access denied. Gen3 and newer rings need an active Oura Membership for API access.',
    )
  }
  throw new UpstreamError('oura', response.status, detail)
}

/** Fetches every page of a /v2/usercollection endpoint. */
async function fetchAll<T extends z.ZodType>(
  userId: string,
  collection: OuraCollection,
  item: T,
  params: Record<string, string>,
): Promise<z.output<T>[]> {
  const Page = z.object({ data: z.array(item), next_token: z.string().nullish() })
  const items: z.output<T>[] = []
  let nextToken: string | null | undefined
  do {
    const page = Page.parse(
      await ouraGet(userId, `/v2/usercollection/${collection}`, {
        ...params,
        ...(nextToken && { next_token: nextToken }),
      }),
    )
    items.push(...page.data)
    nextToken = page.next_token
  } while (nextToken)
  return items
}

// Documents are kept whole: the loose schemas check only what storing them relies on.
const Document = z.looseObject({ id: z.string() })
const Sample = z.looseObject({ timestamp: z.string() })

export type OuraSample = z.output<typeof Sample>

/**
 * Documents of a dated collection for days `start` to `end`. Some collections treat end_date as
 * exclusive or match nights on when they began, so the range is padded on both sides; callers
 * keep the days they asked for.
 */
export function getDocuments(
  userId: string,
  collection: OuraCollection,
  start: IsoDate,
  end: IsoDate,
) {
  return fetchAll(userId, collection, Document, {
    start_date: addDays(start, -1),
    end_date: addDays(end, 1),
  })
}

/** A time series between two instants. */
export async function getSamples(userId: string, collection: OuraCollection, from: Date, to: Date) {
  const samples: OuraSample[] = []
  for (let start = from.getTime(); start < to.getTime(); start += MAX_SAMPLE_RANGE_MS) {
    const end = Math.min(to.getTime(), start + MAX_SAMPLE_RANGE_MS)
    samples.push(
      ...(await fetchAll(userId, collection, Sample, {
        start_datetime: new Date(start).toISOString(),
        end_datetime: new Date(end).toISOString(),
      })),
    )
  }
  return samples
}

/** Every document of a collection without dates, such as the user's rings. */
export function getUndatedDocuments(userId: string, collection: OuraCollection) {
  return fetchAll(userId, collection, Document, {})
}

/** A collection that is a single document rather than a page (personal_info). */
export async function getSingleDocument(userId: string, collection: OuraCollection) {
  return Document.parse(await ouraGet(userId, `/v2/usercollection/${collection}`, {}))
}
