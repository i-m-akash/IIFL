import { and, count, desc, eq } from 'drizzle-orm'
import type { createDb } from '../db'
import { botAnalyticsRows, botCallLogs, bots } from '../db/schema'
import type { AuthPayload } from '../lib/jwt'

type Db = ReturnType<typeof createDb>

async function resolveBot(db: Db, session: AuthPayload, externalRef: string) {
  const rows = await db
    .select()
    .from(bots)
    .where(and(eq(bots.adminId, session.adminId), eq(bots.externalRef, externalRef)))
    .limit(1)
  const bot = rows[0]
  if (!bot) return null
  if (session.role === 'client' && session.clientId) {
    if (bot.clientId && bot.clientId !== session.clientId) return null
  }
  return bot
}

export async function canAccessAgent(db: Db, user: AuthPayload, externalRef: string) {
  return await resolveBot(db, user, externalRef)
}

function formatLogRow(row: typeof botCallLogs.$inferSelect) {
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const dateStr = occurredAt.toISOString().slice(0, 10)
  const timeStr = `${pad(occurredAt.getUTCHours())}:${pad(occurredAt.getUTCMinutes())}:${pad(occurredAt.getUTCSeconds())}`

  let meta: Record<string, unknown> = {}
  if (row.metaJson) {
    try {
      meta = JSON.parse(row.metaJson) as Record<string, unknown>
    } catch {
      meta = {}
    }
  }

  const durationSeconds = row.durationSec ?? 0
  const duration = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`

  return {
    Date: dateStr,
    Time: timeStr,
    Direction: row.direction || 'outbound',
    CustomerNumber: row.customerNumber || '',
    StartTime: timeStr,
    EndTime: timeStr,
    Duration: duration,
    ActionPerformed: row.actionSummary || 'Answered',
    CallForwarded: String(meta.CallForwardedTo || meta.callForwardedTo || meta.CallForwarded || ''),
  }
}

const analyticsKeyMap: Record<string, string> = {
  customerName: 'CustomerName',
  customerNumber: 'CustomerNumber',
  clientName: 'ClientName',
  loanType: 'LoanType',
  emiAmount: 'LoanAmount',
  sentiment: 'Sentiment',
  callOutcome: 'CallOutcome',
  preferredLanguage: 'PreferredLanguage',
  summary: 'Summary',
  callPurpose: 'CallPurpose',
  customerSatisfaction: 'CustomerSatisfaction',
  willingToPay: 'WillingToPay',
  paymentTimeline: 'PaymentTimeline',
  modeOfPayment: 'ModeOfPayment',
  paymentDate: 'PaymentDate',
  payableAmount: 'PayableAmount',
  reasonForNonPayment: 'ReasonForNonPayment',
  callbackRequested: 'CallbackRequested',
  callbackDatetime: 'CallbackDatetime',
  callbackReason: 'CallbackReason',
  transcript: 'Transcript',
  callRecording: 'CallRecording',
}

function formatAnalyticsRow(row: typeof botAnalyticsRows.$inferSelect) {
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const dateStr = occurredAt.toISOString().slice(0, 10)
  const timeStr = `${pad(occurredAt.getUTCHours())}:${pad(occurredAt.getUTCMinutes())}:${pad(occurredAt.getUTCSeconds())}`

  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(row.metaJson) as Record<string, unknown>
  } catch {
    raw = {}
  }

  const out: Record<string, string> = {
    Date: dateStr,
    Time: timeStr,
  }

  for (const [key, value] of Object.entries(raw)) {
    const column = analyticsKeyMap[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
    out[column] = value == null ? '' : String(value)
  }

  return out
}

export async function getCallLogsD1(db: Db, session: AuthPayload, agentExternalRef: string, page: number, pageSize: number) {
  const bot = await resolveBot(db, session, agentExternalRef)
  if (!bot) {
    return { pages: {}, totalPages: 1, totalCount: 0 }
  }

  const countRow = await db.select({ c: count() }).from(botCallLogs).where(eq(botCallLogs.botId, bot.id))
  const totalCount = Number(countRow[0]?.c ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pagesToFetch = [page, page + 1, page + 2].filter((candidate) => candidate >= 1 && candidate <= totalPages)
  const pages: Record<number, ReturnType<typeof formatLogRow>[]> = {}

  for (const currentPage of pagesToFetch) {
    const offset = (currentPage - 1) * pageSize
    const logs = await db
      .select()
      .from(botCallLogs)
      .where(eq(botCallLogs.botId, bot.id))
      .orderBy(desc(botCallLogs.occurredAt))
      .limit(pageSize)
      .offset(offset)

    pages[currentPage] = logs.map(formatLogRow)
  }

  return { pages, totalPages, totalCount }
}

export async function getCallAnalyticsD1(
  db: Db,
  session: AuthPayload,
  agentExternalRef: string,
  page: number,
  pageSize: number
) {
  const bot = await resolveBot(db, session, agentExternalRef)
  if (!bot) {
    return { pages: {}, totalPages: 1, totalCount: 0 }
  }

  const countRow = await db.select({ c: count() }).from(botAnalyticsRows).where(eq(botAnalyticsRows.botId, bot.id))
  const totalCount = Number(countRow[0]?.c ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pagesToFetch = [page, page + 1, page + 2].filter((candidate) => candidate >= 1 && candidate <= totalPages)
  const pages: Record<number, ReturnType<typeof formatAnalyticsRow>[]> = {}

  for (const currentPage of pagesToFetch) {
    const offset = (currentPage - 1) * pageSize
    const rows = await db
      .select()
      .from(botAnalyticsRows)
      .where(eq(botAnalyticsRows.botId, bot.id))
      .orderBy(desc(botAnalyticsRows.occurredAt))
      .limit(pageSize)
      .offset(offset)

    pages[currentPage] = rows.map(formatAnalyticsRow)
  }

  return { pages, totalPages, totalCount }
}

export async function getAllCallAnalyticsD1(db: Db, session: AuthPayload, agentExternalRef: string) {
  const bot = await resolveBot(db, session, agentExternalRef)
  if (!bot) return []

  const pageSize = 1000
  const allRows: ReturnType<typeof formatAnalyticsRow>[] = []
  let offset = 0

  while (true) {
    const rows = await db
      .select()
      .from(botAnalyticsRows)
      .where(eq(botAnalyticsRows.botId, bot.id))
      .orderBy(desc(botAnalyticsRows.occurredAt))
      .limit(pageSize)
      .offset(offset)

    allRows.push(...rows.map(formatAnalyticsRow))
    if (rows.length < pageSize) break
    offset += pageSize
  }

  return allRows
}
