import { Hono } from 'hono'
import type { Context } from 'hono'
import { eq } from 'drizzle-orm'

import { admins } from '../db/schema'
import { canViewAgentInsights } from '../lib/roles'
import { answerAnalyticsQuestionWithModel, type AnalyticsChatHistoryMessage } from '../services/analyticsChat'
import { getAllCallDashboardPostgres, getCallDashboardPostgres } from '../services/dashboardPostgres'
import type { AppEnv } from '../types'
import { canAccessAgent, getAllCallAnalyticsD1, getCallAnalyticsD1, getCallLogsD1 } from '../middleware/agentAccess'
import { authMiddleware } from '../middleware/auth'

export const dashboardRoutes = new Hono<AppEnv>().use('*', authMiddleware)

function readPagination(c: Context<AppEnv>) {
  const isDownload = c.req.query('download') === 'true'
  const page = isDownload ? 1 : Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = isDownload ? 10000 : Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '10', 10) || 10))
  return { page, pageSize }
}

async function dashboardPageJson(c: Context<AppEnv>, kind: 'logs' | 'analytics', agentId: string) {
  const user = c.get('user')!
  if (!canViewAgentInsights(user.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const db = c.get('db')!
  const botRow = await canAccessAgent(db, user, agentId)
  if (!botRow) return c.json({ success: false, error: 'Forbidden' }, 403)

  const adminRow = (await db.select().from(admins).where(eq(admins.id, user.adminId)).limit(1))[0]
  if (!adminRow) return c.json({ success: false, error: 'Admin not found' }, 404)

  const { page, pageSize } = readPagination(c)
  const batchId = c.req.query('batchId')?.trim() || undefined
  const options = {
    batchId,
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    search: c.req.query('search'),
  }

  let pages: Record<number, Record<string, string>[]> = {}
  let totalPages = 1
  let totalCount = 0
  const analyticsSource = adminRow.analyticsSource ?? 'd1'
  const querySql = kind === 'analytics' ? botRow.dashboardAnalyticsQuery : botRow.dashboardLogsQuery

  if (analyticsSource === 'hyperdrive_postgres') {
    if (!querySql) {
      return c.json({ success: false, error: `No ${kind} query configured for this agent` }, 400)
    }

    ;({ pages, totalPages, totalCount } = await getCallDashboardPostgres(
      c.env,
      adminRow.datasourceBinding,
      querySql,
      agentId,
      page,
      pageSize,
      options
    ))
  } else if (analyticsSource === 'd1' && kind === 'logs') {
    ;({ pages, totalPages, totalCount } = await getCallLogsD1(db, user, agentId, page, pageSize))
  } else if (analyticsSource === 'd1') {
    ;({ pages, totalPages, totalCount } = await getCallAnalyticsD1(db, user, agentId, page, pageSize))
  } else {
    return c.json(
      {
        success: false,
        error: `Unsupported dashboard datasource '${analyticsSource}' for admin ${adminRow.slug}`,
      },
      500
    )
  }

  return c.json({
    pages,
    totalPages,
    currentPage: page,
    totalCount,
  })
}

dashboardRoutes.get('/calllogs/:agentId', async (c) => {
  try {
    return await dashboardPageJson(c, 'logs', c.req.param('agentId'))
  } catch (e) {
    console.error(e)
    return c.json({ success: false, error: 'Failed to fetch call logs' }, 500)
  }
})

dashboardRoutes.get('/callanalytics/:agentId', async (c) => {
  try {
    return await dashboardPageJson(c, 'analytics', c.req.param('agentId'))
  } catch (e) {
    console.error(e)
    return c.json({ success: false, error: 'Failed to fetch call analytics' }, 500)
  }
})

dashboardRoutes.post('/analytics-chat/:agentId', async (c) => {
  try {
    const user = c.get('user')!
    if (!canViewAgentInsights(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const db = c.get('db')!
    const agentId = c.req.param('agentId')
    const botRow = await canAccessAgent(db, user, agentId)
    if (!botRow) return c.json({ success: false, error: 'Forbidden' }, 403)

    const body = (await c.req.json().catch(() => null)) as
      | {
          message?: string
          history?: AnalyticsChatHistoryMessage[]
        }
      | null

    const message = body?.message?.trim()
    if (!message) {
      return c.json({ success: false, error: 'Message is required' }, 400)
    }

    const adminRow = (await db.select().from(admins).where(eq(admins.id, user.adminId)).limit(1))[0]
    if (!adminRow) return c.json({ success: false, error: 'Admin not found' }, 404)

    const history = Array.isArray(body?.history) ? body.history : []
    const analyticsSource = adminRow.analyticsSource ?? 'd1'

    let rows: Record<string, string>[] = []
    if (analyticsSource === 'hyperdrive_postgres') {
      if (!botRow.dashboardAnalyticsQuery) {
        return c.json({ success: false, error: 'No analytics query configured for this agent' }, 400)
      }
      rows = await getAllCallDashboardPostgres(c.env, adminRow.datasourceBinding, botRow.dashboardAnalyticsQuery, agentId)
    } else if (analyticsSource === 'd1') {
      rows = await getAllCallAnalyticsD1(db, user, agentId)
    } else {
      return c.json(
        {
          success: false,
          error: `Unsupported dashboard datasource '${analyticsSource}' for admin ${adminRow.slug}`,
        },
        500,
      )
    }

    const result = await answerAnalyticsQuestionWithModel(c.env, message, rows, history)
    return c.json({ success: true, data: result })
  } catch (e) {
    console.error(e)
    return c.json({ success: false, error: 'Failed to answer analytics question' }, 500)
  }
})
