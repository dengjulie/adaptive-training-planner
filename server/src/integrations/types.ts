import type { Provider } from '../db/schema.ts'

export type Integration = {
  provider: Provider
  label: string
  /** Whether the server has the OAuth client settings this integration needs. */
  configured: boolean
  /**
   * Revokes our access at the provider (best effort) and deletes everything stored from it,
   * including the connection itself.
   */
  disconnect(userId: string): Promise<void>
}
