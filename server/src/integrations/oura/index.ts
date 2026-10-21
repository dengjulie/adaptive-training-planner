import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { connections, ouraDaily, ouraRecords, planAdjustments } from '../../db/schema.ts'
import { ouraOAuth } from '../../env.ts'
import { getConnection } from '../../lib/connections.ts'
import type { Integration } from '../types.ts'
import { revokeOuraAccess } from './oauth.ts'

export const ouraIntegration: Integration = {
  provider: 'oura',
  label: 'Oura',
  configured: ouraOAuth !== null,
  async disconnect(userId) {
    const connection = await getConnection(userId, 'oura')
    if (connection) await revokeOuraAccess(connection)
    const ouraConnection = and(eq(connections.userId, userId), eq(connections.provider, 'oura'))
    // The data and the connection go in one transaction, so neither outlives the other. The
    // lock comes first: a sync holds a share lock on the connection while it writes (sync.ts),
    // so this waits for it and then deletes what it wrote, and a sync starting after this
    // commits finds no connection and writes nothing.
    await db.transaction(async (tx) => {
      await tx.select({ id: connections.id }).from(connections).where(ouraConnection).for('update')
      await tx.delete(ouraDaily).where(eq(ouraDaily.userId, userId))
      await tx.delete(ouraRecords).where(eq(ouraRecords.userId, userId))
      // Readiness changes to the plan are Oura-derived too; sessions fall back to their base.
      await tx.delete(planAdjustments).where(eq(planAdjustments.userId, userId))
      await tx.delete(connections).where(ouraConnection)
    })
  },
}
