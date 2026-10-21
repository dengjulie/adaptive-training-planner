import { useQuery } from '@tanstack/react-query'

export type Provider = 'google' | 'oura' | 'coros'

export type IntegrationSummary = {
  provider: Provider
  label: string
  configured: boolean
  connected: boolean
  status: 'active' | 'reauth_required' | null
  connectedAt: string | null
}

export type Me = {
  user: { id: string; email: string; timezone: string }
  integrations: IntegrationSummary[]
}

type ErrorBody = { error?: string; message?: string; provider?: Provider }

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly provider: Provider | undefined
  constructor(status: number, body: ErrorBody, fallbackMessage: string) {
    super(body.message ?? fallbackMessage)
    this.name = 'ApiError'
    this.status = status
    this.code = body.error
    this.provider = body.provider
  }
}

/** JSON fetch against our own server. Throws ApiError for non-2xx responses. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody
    throw new ApiError(response.status, body, response.statusText)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me') })
}

/** Starts an OAuth flow for a provider (full-page navigation to the server). */
export function connectUrl(provider: Provider) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `/auth/${provider}/start?tz=${encodeURIComponent(timezone)}`
}
