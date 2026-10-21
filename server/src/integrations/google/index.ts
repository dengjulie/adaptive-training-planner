import { googleOAuth } from '../../env.ts'
import { deleteConnection, getConnection } from '../../lib/connections.ts'
import { decryptSecret } from '../../lib/crypto.ts'
import type { Integration } from '../types.ts'
import { revokeGoogleGrant } from './oauth.ts'

export const googleIntegration: Integration = {
  provider: 'google',
  label: 'Google Calendar',
  configured: googleOAuth !== null,
  async disconnect(userId) {
    const connection = await getConnection(userId, 'google')
    if (connection) {
      await revokeGoogleGrant(decryptSecret(connection.refreshToken ?? connection.accessToken))
    }
    // users.trainingCalendarId is kept: the calendar stays in the user's Google account, and
    // reconnecting reuses it instead of creating a second "Training" calendar.
    await deleteConnection(userId, 'google')
  },
}
