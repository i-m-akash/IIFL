import { Hono } from 'hono'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { agentActivityLogs } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import type { AppEnv } from '../types'

export const notificationsRoutes = new Hono<AppEnv>()
  .use('*', authMiddleware)
  .get('/', async (c) => {
    const user = c.get('user')!
    const db = c.get('db')!
    const limit = Math.min(30, Math.max(1, parseInt(c.req.query('limit') || '10', 10) || 10))

    const scope =
      user.role === 'client' && user.clientId
        ? and(
            eq(agentActivityLogs.adminId, user.adminId),
            or(isNull(agentActivityLogs.clientId), eq(agentActivityLogs.clientId, user.clientId))
          )
        : eq(agentActivityLogs.adminId, user.adminId)

    const rows = await db.select().from(agentActivityLogs).where(scope).orderBy(desc(agentActivityLogs.createdAt)).limit(limit)

    return c.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        title: row.title,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      })),
    })
  })
