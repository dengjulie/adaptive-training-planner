import { deleteConnection } from '../../lib/connections.ts'
import type { Integration } from '../types.ts'

export const corosIntegration: Integration = {
  provider: 'coros',
  label: 'COROS',
  // Nothing to configure: the app registers itself with COROS the first time someone connects.
  configured: true,
  async disconnect(userId) {
    // COROS doesn't let public clients revoke tokens, so deleting them is what ends our access.
    await deleteConnection(userId, 'coros')
  },
}
