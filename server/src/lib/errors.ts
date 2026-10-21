import type { Provider } from '../db/schema.ts'

const NAMES: Record<Provider, string> = { google: 'Google', oura: 'Oura', coros: 'COROS' }

/** Base class for failures tied to one integration; the API reports `provider` to the UI. */
export class IntegrationError extends Error {
  readonly provider: Provider
  constructor(provider: Provider, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.provider = provider
  }
}

/** The user hasn't connected this integration yet. */
export class NotConnectedError extends IntegrationError {
  constructor(provider: Provider) {
    super(provider, `${NAMES[provider]} is not connected`)
  }
}

/** Stored credentials stopped working (revoked, expired refresh token); the user must reconnect. */
export class ReauthRequiredError extends IntegrationError {
  constructor(provider: Provider, cause?: unknown) {
    super(provider, `${NAMES[provider]} needs to be reconnected`, { cause })
  }
}

/**
 * The user didn't grant the scope a request needs. Reconnecting and allowing it fixes that, so
 * it's a ReauthRequiredError, but callers that can do without the data may catch it and go on.
 */
export class MissingScopeError extends ReauthRequiredError {}

/** The integration's OAuth client isn't configured in .env. */
export class NotConfiguredError extends IntegrationError {
  constructor(provider: Provider) {
    super(provider, `${NAMES[provider]} is not configured on the server (see .env.example)`)
  }
}

/** A provider API call failed. `status` is the upstream HTTP status. */
export class UpstreamError extends IntegrationError {
  readonly status: number
  constructor(provider: Provider, status: number, message: string) {
    super(provider, `${NAMES[provider]} API error ${status}: ${message}`)
    this.status = status
  }
}
