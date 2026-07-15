import { Hono } from 'hono'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import Papa from 'papaparse'
import { createDb } from '../db'
import { admins, bots, clients } from '../db/schema'
import type { AuthPayload } from '../lib/jwt'
import { canManageCampaigns, canViewCampaigns } from '../lib/roles'
import type { AppEnv } from '../types'
import {
  type CampaignRow,
  type LeadRow,
  getCampaignById,
  getPendingLeads,
  insertCampaign,
  resolveMlBatchId,
  insertLead,
  listCampaigns,
  listLeads,
  listLeadStatuses,
  updateCampaign,
  updateCampaignImportMetadata,
  setLeadsStatus,
} from '../services/campaignStore'
import { dumpCampaignBatchToPostgres } from '../services/campaignsLeadsToPostgres'
import {
  getPostgresCampaignCardByBatch,
  listPostgresCampaignCards,
  listPostgresLeadsByBatch,
  mergeCampaignKey,
  parseCampaignListDate,
  parsePostgresCampaignId,
  postgresCampaignId,
  postgresCampaignMetrics,
  type PostgresCampaignCard,
} from '../services/campaignPostgresList'
import { resolveMlApiUrlForAdmin } from '../services/mlApiUrl'
import { authMiddleware } from '../middleware/auth'

type Db = ReturnType<typeof createDb>

type ColumnSchema = {
  key: string
  label: string
  required?: boolean
  type?: string
  system?: boolean
}

const requiredColumns: ColumnSchema[] = [
  { key: 'reference_id', label: 'Reference ID', required: true, type: 'text', system: true },
  { key: 'party_name', label: 'Party Name', required: true, type: 'text', system: true },
  { key: 'party_mobile_number', label: 'Party Mobile Number', required: true, type: 'phone', system: true },
]

const knownOptionalColumns: ColumnSchema[] = [
  { key: 'emi_amount', label: 'EMI Amount', type: 'currency', system: true },
  { key: 'emi_date', label: 'EMI Date', type: 'date', system: true },
  { key: 'loan_type', label: 'Loan Type', type: 'text', system: true },
  { key: 'preferred_language', label: 'Preferred Language', type: 'text', system: true },
]

const columnAliases: Record<string, string[]> = {
  reference_id: ['reference_id', 'reference id', 'reference', 'id', 'case id', 'case_id'],
  batch_id: ['batch_id', 'batch id', 'batch'],
  agent_id: ['agent_id', 'agent id', 'agent', 'bot id', 'bot_id'],
  client_name: ['client_name', 'client name', 'client'],
  party_name: ['party_name', 'party name', 'name', 'customer name', 'full name', 'customer', 'borrower name'],
  party_mobile_number: [
    'party_mobile_number',
    'party mobile number',
    'mobile number',
    'mobile no',
    'mobile',
    'phone number',
    'phone no',
    'phone',
    'contact number',
  ],
  emi_amount: ['emi_amount', 'emi amount', 'amount', 'loan amount', 'due amount', 'outstanding amount', 'balance'],
  emi_date: ['emi_date', 'emi date', 'due date', 'due', 'payment due', 'last date', 'deadline'],
  loan_type: ['loan_type', 'loan type', 'type', 'product type', 'product_type'],
  preferred_language: ['preferred_language', 'preferred language', 'language', 'lang', 'communication language'],
}

const knownColumns = [...requiredColumns, ...knownOptionalColumns]

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  clientId: z.string().trim().min(1),
  agent_id: z.string().trim().min(1),
  languages: z.array(z.string().trim().min(1).max(40)).optional().default([]),
  scheduledAt: z.string().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
})

const updateCampaignSchema = createCampaignSchema.partial()
const recreateCampaignSchema = z.object({
  selection: z.enum(['unanswered', 'short_answered', 'combined']),
  shortCallThresholdSec: z.number().int().min(1).max(600).optional().default(15),
  scheduledAt: z.string().optional().nullable(),
  name: z.string().trim().min(1).max(160).optional(),
})

export const campaignsRoutes = new Hono<AppEnv>()

campaignsRoutes.get('/health', (c) => c.json({ success: true, message: 'Campaigns API is running' }))
campaignsRoutes.use('*', authMiddleware)

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : undefined
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function inferColumnType(label: string): string {
  const normalized = label.toLowerCase()
  if (normalized.includes('mobile') || normalized.includes('phone') || normalized.includes('contact')) return 'phone'
  if (normalized.includes('amount') || normalized.includes('price') || normalized.includes('balance') || normalized.includes('emi')) return 'currency'
  if (normalized.includes('date') || normalized.includes('due') || normalized.includes('deadline')) return 'date'
  if (normalized.includes('count') || normalized.includes('score') || normalized.includes('age')) return 'number'
  return 'text'
}

function normalizeColumns(columns: ColumnSchema[]) {
  const seen = new Set<string>()
  const normalized: ColumnSchema[] = []

  for (const column of [...knownColumns, ...columns]) {
    if (!column.key || seen.has(column.key)) continue
    seen.add(column.key)
    normalized.push(column)
  }

  return normalized
}

function columnsFromHeaders(headers: string[]) {
  const seen = new Set<string>()
  const knownKeys = new Set(knownColumns.map((column) => column.key))
  const optional: ColumnSchema[] = []

  for (const header of headers) {
    const label = header.trim()
    const key = normalizeKey(label)
    if (!key || seen.has(key) || knownKeys.has(key)) continue
    seen.add(key)
    optional.push({ key, label, type: inferColumnType(label) })
  }

  return normalizeColumns(optional)
}



function buildHeaderMapping(headers: string[], columns: ColumnSchema[]) {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeKey(header) }))
  const mapping = new Map<string, string>()

  for (const column of columns) {
    const key = normalizeKey(column.key)
    const label = normalizeKey(column.label)
    const aliases = (columnAliases[column.key] ?? []).map(normalizeKey)
    const match = normalizedHeaders.find((item) => item.normalized === key || item.normalized === label || aliases.includes(item.normalized))
    if (match) mapping.set(column.key, match.header)
  }

  return mapping
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  const date = new Date(hasTimezone ? trimmed : `${trimmed}+05:30`)
  return Number.isNaN(date.getTime()) ? null : date
}

function isUnansweredStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').trim().toLowerCase()
  return ['failed', 'dropped', 'busy', 'no_response', 'no response', 'unanswered'].includes(normalized)
}

function isAnsweredStatus(status: string | null | undefined) {
  const normalized = String(status ?? '').trim().toLowerCase()
  return ['completed', 'answered'].includes(normalized)
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)

  const hhmmss = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (hhmmss) {
    const first = Number(hhmmss[1] ?? 0)
    const second = Number(hhmmss[2] ?? 0)
    const third = Number(hhmmss[3] ?? 0)
    return hhmmss[3] ? first * 3600 + second * 60 + third : first * 60 + second
  }

  const units = raw.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i)
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  }

  return null
}

function extractShortCallDurationSeconds(lead: LeadRow) {
  const extraData = parseJson<Record<string, unknown>>(lead.extraDataJson, {})
  const webhook = extraData.webhook && typeof extraData.webhook === 'object' ? (extraData.webhook as Record<string, unknown>) : extraData
  const candidates = [
    webhook.durationSec,
    webhook.duration_sec,
    webhook.durationSeconds,
    webhook.duration_seconds,
    webhook.callDuration,
    webhook.call_duration,
    webhook.talkTime,
    webhook.talk_time,
    webhook.conversationDuration,
    webhook.conversation_duration,
    webhook.billsec,
  ]

  for (const candidate of candidates) {
    const seconds = parseDurationSeconds(candidate)
    if (seconds !== null) return seconds
  }

  return null
}

function leadMatchesRetrySelection(
  lead: LeadRow,
  selection: z.infer<typeof recreateCampaignSchema>['selection'],
  shortCallThresholdSec: number,
) {
  const unanswered = isUnansweredStatus(lead.callStatus)
  const durationSec = extractShortCallDurationSeconds(lead)
  const shortAnswered = isAnsweredStatus(lead.callStatus) && durationSec !== null && durationSec <= shortCallThresholdSec

  if (selection === 'unanswered') return unanswered
  if (selection === 'short_answered') return shortAnswered
  return unanswered || shortAnswered
}

function isTruthyFlag(value: string | undefined) {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

async function findBotByAgentId(db: Db, session: AuthPayload, agentId: string, clientId?: string) {
  const botWhere =
    session.role === 'client' && session.clientId
      ? and(
          eq(bots.adminId, session.adminId),
          eq(bots.externalRef, agentId),
          or(isNull(bots.clientId), eq(bots.clientId, session.clientId))
        )
      : and(
          eq(bots.adminId, session.adminId),
          eq(bots.externalRef, agentId),
          clientId ? or(isNull(bots.clientId), eq(bots.clientId, clientId)) : undefined
        )

  return (await db.select().from(bots).where(botWhere).limit(1))[0]
}

async function getNamesForCampaign(db: Db, campaign: Pick<CampaignRow, 'clientId' | 'botId'>) {
  const [client, bot] = await Promise.all([
    db.select({ name: clients.name }).from(clients).where(eq(clients.id, campaign.clientId)).limit(1),
    db.select({ externalRef: bots.externalRef, name: bots.name }).from(bots).where(eq(bots.id, campaign.botId)).limit(1),
  ])

  return {
    clientName: client[0]?.name ?? '',
    agentExternalRef: bot[0]?.externalRef ?? campaign.botId,
    agentName: bot[0]?.name ?? '',
  }
}

async function getCampaignWithNames(env: AppEnv['Bindings'], db: Db, session: AuthPayload, campaignId: string) {
  const campaign = await getCampaignById(env, session.adminId, campaignId, session.role === 'client' ? (session.clientId ?? undefined) : undefined)
  if (!campaign) return null
  return { campaign, ...(await getNamesForCampaign(db, campaign)) }
}

function leadToApi(lead: LeadRow) {
  return {
    id: lead.id,
    reference_id: lead.referenceId,
    party_name: lead.partyName ?? '',
    party_mobile_number: lead.partyMobile ?? '',
    batch_id: lead.uploadBatchId,
    callStatus: lead.callStatus,
    data: parseJson<Record<string, unknown>>(lead.dataJson, {}),
    extraData: parseJson<Record<string, unknown>>(lead.extraDataJson, {}),
    uploadTimestamp: toIso(lead.createdAt),
    createdAt: toIso(lead.createdAt),
    fileName: lead.fileName ?? '',
    scheduledDateTime: toIso(lead.scheduledAt),
    scheduledAt: toIso(lead.scheduledAt),
  }
}

function postgresLeadToApi(lead: Awaited<ReturnType<typeof listPostgresLeadsByBatch>>[number]) {
  return {
    id: lead.reference_id,
    reference_id: lead.reference_id,
    party_name: lead.party_name,
    party_mobile_number: lead.party_mobile_number,
    batch_id: lead.batch_id,
    callStatus: 'pending',
    preferred_language: lead.preferred_language,
    data: lead.preferred_language ? { preferred_language: lead.preferred_language } : {},
    extraData: {},
    uploadTimestamp: lead.created_at,
    createdAt: lead.created_at,
    fileName: '',
    scheduledDateTime: undefined,
    scheduledAt: undefined,
  }
}

async function resolveCampaignLeads(
  env: AppEnv['Bindings'],
  adminId: string,
  agentExternalRef: string,
  batchId: string | null | undefined,
  d1CampaignId?: string,
) {
  if (d1CampaignId) {
    const rows = await listLeads(env, adminId, d1CampaignId)
    if (rows.length > 0) return rows.map(leadToApi)
  }

  const trimmedBatch = batchId?.trim()
  const trimmedAgent = agentExternalRef?.trim()
  if (trimmedBatch && trimmedAgent) {
    const pgLeads = await listPostgresLeadsByBatch(env, adminId, trimmedAgent, trimmedBatch)
    if (pgLeads.length > 0) return pgLeads.map(postgresLeadToApi)
  }

  return []
}

function calculateMetrics(leads: Pick<LeadRow, 'callStatus' | 'uploadBatchId'>[]) {
  const total = leads.length
  const norm = (s: string | null | undefined) => (s ?? 'pending').toLowerCase()
  const completed = leads.filter((lead) => ['completed', 'answered'].includes(norm(lead.callStatus))).length
  const failed = leads.filter((lead) => ['failed', 'dropped'].includes(norm(lead.callStatus))).length
  const pending = leads.filter((lead) => ['pending', 'processing'].includes(norm(lead.callStatus))).length
  const promiseToPay = leads.filter((lead) => ['ptp', 'promise_to_pay'].includes(norm(lead.callStatus))).length
  const answerRate = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    total,
    pending,
    completed,
    failed,
    answerRate,
    promiseToPay,
  }
}

function calculateOutcomes(leads: Pick<LeadRow, 'callStatus' | 'uploadBatchId'>[]) {
  return leads.reduce(
    (acc, lead) => {
      const status = (lead.callStatus ?? 'pending').toLowerCase()
      if (status === 'ptp' || status === 'promise_to_pay') acc.ptp += 1
      else if (status === 'dropped' || status === 'failed') acc.dropped += 1
      else if (status === 'busy') acc.busy += 1
      else if (status === 'no_response' || status === 'no response') acc.noResponse += 1
      return acc
    },
    { ptp: 0, dropped: 0, busy: 0, noResponse: 0 }
  )
}

function campaignStatus(campaign: CampaignRow, metrics: ReturnType<typeof calculateMetrics>) {
  if (campaign.status.toLowerCase() === 'failed') return 'failed'
  if (campaign.status.toLowerCase() === 'live') return 'live'
  if (metrics.total > 0 && metrics.pending === 0) {
    if (metrics.failed === metrics.total) return 'failed'
    return 'completed'
  }
  return campaign.status
}

function campaignDateKeyIst(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function d1CampaignMatchesDate(campaign: CampaignRow, dateKey: string) {
  return campaignDateKeyIst(campaign.scheduledAt ?? campaign.createdAt) === dateKey
}

function postgresCardToApi(card: PostgresCampaignCard) {
  return {
    id: postgresCampaignId(card.agent_id, card.batch_id),
    name: card.client_name || card.batch_id,
    description: '',
    clientId: '',
    clientName: card.client_name,
    agent_id: card.agent_id,
    agentName: card.agent_name,
    batch_id: card.batch_id,
    languages: [] as string[],
    status: 'live',
    scheduledAt: card.start_date,
    createdAt: card.start_date,
    updatedAt: card.end_date,
    columnsSchema: requiredColumns,
    metrics: postgresCampaignMetrics(card),
    outcomes: { ptp: 0, dropped: 0, busy: 0, noResponse: 0 },
    source: 'postgres' as const,
  }
}

function enrichD1WithPostgres(
  api: ReturnType<typeof campaignToApi>,
  card: PostgresCampaignCard,
) {
  return {
    ...api,
    batch_id: api.batch_id || card.batch_id,
    clientName: api.clientName || card.client_name,
    name: api.name || card.client_name || card.batch_id,
    metrics: postgresCampaignMetrics(card),
    outcomes: { ptp: 0, dropped: 0, busy: 0, noResponse: card.unanswered_calls },
    source: 'merged' as const,
  }
}

function campaignToApi(
  campaign: CampaignRow,
  names: { clientName: string; agentExternalRef: string; agentName: string },
  leads: Pick<LeadRow, 'callStatus' | 'uploadBatchId'>[] = []
) {
  const metrics = calculateMetrics(leads)
  const batchIds = [...new Set(leads.map((l) => l.uploadBatchId).filter(Boolean))]
  const batch_id =
    batchIds.length === 0 ? null : batchIds.length === 1 ? batchIds[0]! : batchIds[0]!

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description ?? '',
    clientId: campaign.clientId,
    clientName: names.clientName,
    agent_id: names.agentExternalRef,
    agentName: names.agentName,
    /** Same `batch_id` sent to ML and stored in Postgres for each lead (`upload_batch_id`). */
    batch_id,
    languages: parseJson<string[]>(campaign.languagesJson, []),
    status: campaignStatus(campaign, metrics),
    scheduledAt: toIso(campaign.scheduledAt),
    createdAt: toIso(campaign.createdAt),
    updatedAt: toIso(campaign.updatedAt),
    columnsSchema: parseJson<ColumnSchema[]>(campaign.columnsSchemaJson, requiredColumns),
    metrics,
    outcomes: calculateOutcomes(leads),
  }
}

async function getPostgresCampaignApi(
  env: AppEnv['Bindings'],
  db: Db,
  session: AuthPayload,
  agentId: string,
  batchId: string,
) {
  const card = await getPostgresCampaignCardByBatch(env, session.adminId, agentId, batchId)
  if (!card) {
    const bot = await findBotByAgentId(db, session, agentId)
    if (!bot) return null
    return postgresCardToApi({
      batch_id: batchId,
      client_name: batchId,
      agent_id: agentId,
      agent_name: bot.name,
      start_date: '',
      end_date: '',
      total_triggered: 0,
      answered_calls: 0,
      unanswered_calls: 0,
    })
  }
  return postgresCardToApi(card)
}

campaignsRoutes.get('/clients', async (c) => {
  const s = c.get('user')!
  if (!canViewCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const db = c.get('db')!
  if (s.role === 'client' && s.clientId) {
    const own = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.adminId, s.adminId), eq(clients.id, s.clientId)))
      .limit(1)
    return c.json({ success: true, data: own })
  }
  const rows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.adminId, s.adminId))
    .orderBy(clients.name)
  return c.json({ success: true, data: rows })
})

campaignsRoutes.post('/clients', async (c) => {
  const s = c.get('user')!
  if (!canManageCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as { name?: string } | null
  if (!body?.name?.trim()) return c.json({ success: false, error: 'Client name is required' }, 400)

  const id = crypto.randomUUID()
  const db = c.get('db')!
  await db.insert(clients).values({
    id,
    adminId: s.adminId,
    name: body.name.trim(),
    createdAt: new Date(),
  })
  return c.json({ success: true, data: { clientId: id, id, name: body.name.trim() } })
})

campaignsRoutes.get('/', async (c) => {
  const s = c.get('user')!
  const db = c.get('db')!
  const dateKey = parseCampaignListDate(c.req.query('date'))
  const agentFilter = c.req.query('agent')?.trim() || null
  const botRefs = new Map(
    (
      await db
        .select({ id: bots.id, externalRef: bots.externalRef })
        .from(bots)
        .where(eq(bots.adminId, s.adminId))
    ).map((bot) => [bot.id, bot.externalRef]),
  )
  const campaigns = await listCampaigns(c.env, s.adminId, s.role === 'client' ? (s.clientId ?? undefined) : undefined)
  let filteredD1 = dateKey ? campaigns.filter((campaign) => d1CampaignMatchesDate(campaign, dateKey)) : campaigns
  if (agentFilter) {
    filteredD1 = filteredD1.filter((campaign) => botRefs.get(campaign.botId) === agentFilter)
  }
  const campaignIds = filteredD1.map((campaign) => campaign.id)
  const leadRows = await listLeadStatuses(c.env, s.adminId, campaignIds)
  const names = new Map<string, Awaited<ReturnType<typeof getNamesForCampaign>>>()
  await Promise.all(filteredD1.map(async (campaign) => names.set(campaign.id, await getNamesForCampaign(db, campaign))))

  let pgCards: PostgresCampaignCard[] = []
  try {
    pgCards = await listPostgresCampaignCards(c.env, s.adminId, dateKey, agentFilter)
  } catch (error) {
    console.error('Postgres campaign list failed; returning D1 campaigns only:', error)
  }
  const pgByKey = new Map(pgCards.map((card) => [mergeCampaignKey(card.agent_id, card.batch_id), card]))
  const mergedKeys = new Set<string>()
  const data: Record<string, unknown>[] = []

  for (const campaign of filteredD1) {
    const campaignNames = names.get(campaign.id) ?? { clientName: '', agentExternalRef: campaign.botId, agentName: '' }
    const leads = leadRows
      .filter((lead) => lead.campaign_id === campaign.id)
      .map((lead) => ({ callStatus: lead.call_status, uploadBatchId: lead.upload_batch_id }))
    const api = campaignToApi(campaign, campaignNames, leads)
    const batchId = api.batch_id?.trim()
    const key = batchId ? mergeCampaignKey(campaignNames.agentExternalRef, batchId) : null
    if (key && pgByKey.has(key)) {
      data.push(enrichD1WithPostgres(api, pgByKey.get(key)!))
      mergedKeys.add(key)
    } else {
      data.push({ ...api, source: 'd1' })
    }
  }

  for (const card of pgCards) {
    const key = mergeCampaignKey(card.agent_id, card.batch_id)
    if (!mergedKeys.has(key)) {
      data.push(postgresCardToApi(card))
    }
  }

  data.sort((left, right) => {
    const leftMs = Date.parse(String(left.updatedAt ?? left.createdAt ?? '')) || 0
    const rightMs = Date.parse(String(right.updatedAt ?? right.createdAt ?? '')) || 0
    return rightMs - leftMs
  })

  return c.json({ success: true, date: dateKey, data })
})

campaignsRoutes.post('/', async (c) => {
  const s = c.get('user')!
  if (s.role === 'client') return c.json({ success: false, error: 'Forbidden' }, 403)

  const body = await c.req.json().catch(() => null)
  const parsed = createCampaignSchema.safeParse(body)
  if (!parsed.success) return c.json({ success: false, error: 'Invalid campaign payload' }, 400)

  const db = c.get('db')!
  const client = (await db.select().from(clients).where(and(eq(clients.adminId, s.adminId), eq(clients.id, parsed.data.clientId))).limit(1))[0]
  if (!client) return c.json({ success: false, error: 'Invalid client' }, 400)

  const bot = await findBotByAgentId(db, s, parsed.data.agent_id, parsed.data.clientId)
  if (!bot) return c.json({ success: false, error: 'Invalid agent' }, 400)

  const now = new Date()
  const id = crypto.randomUUID()
  await insertCampaign(c.env, {
    id,
    adminId: s.adminId,
    clientId: parsed.data.clientId,
    botId: bot.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    status: 'pending',
    languagesJson: JSON.stringify(parsed.data.languages),
    columnsSchemaJson: JSON.stringify(requiredColumns),
    scheduledAt: parseOptionalDate(parsed.data.scheduledAt),
    createdAt: now,
    updatedAt: now,
  })

  const row = await getCampaignWithNames(c.env, db, s, id)
  if (!row) return c.json({ success: false, error: 'Campaign was created but could not be loaded' }, 500)
  return c.json({
    success: true,
    data: campaignToApi(row.campaign, {
      clientName: row.clientName,
      agentExternalRef: row.agentExternalRef,
      agentName: row.agentName,
    }),
  })
})

campaignsRoutes.get('/:campaignId', async (c) => {
  const s = c.get('user')!
  const db = c.get('db')!
  const campaignId = c.req.param('campaignId')
  const pgRef = parsePostgresCampaignId(campaignId)
  if (pgRef) {
    const data = await getPostgresCampaignApi(c.env, db, s, pgRef.agentId, pgRef.batchId)
    if (!data) return c.json({ success: false, error: 'Campaign not found' }, 404)
    return c.json({ success: true, data })
  }

  const row = await getCampaignWithNames(c.env, db, s, campaignId)
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)

  const leadRows = await listLeads(c.env, s.adminId, row.campaign.id)
  const api = campaignToApi(
    row.campaign,
    { clientName: row.clientName, agentExternalRef: row.agentExternalRef, agentName: row.agentName },
    leadRows.map((l) => ({ callStatus: l.callStatus, uploadBatchId: l.uploadBatchId })),
  )

  const batchId = api.batch_id?.trim()
  if (batchId) {
    const pgCard = await getPostgresCampaignCardByBatch(c.env, s.adminId, row.agentExternalRef, batchId)
    if (pgCard) {
      return c.json({ success: true, data: enrichD1WithPostgres(api, pgCard) })
    }
  }

  return c.json({ success: true, data: { ...api, source: 'd1' } })
})

campaignsRoutes.put('/:campaignId', async (c) => {
  const s = c.get('user')!
  if (s.role === 'client') return c.json({ success: false, error: 'Forbidden' }, 403)

  const db = c.get('db')!
  const campaignId = c.req.param('campaignId')
  const existing = await getCampaignWithNames(c.env, db, s, campaignId)
  if (!existing) return c.json({ success: false, error: 'Campaign not found' }, 404)

  const body = await c.req.json().catch(() => null)
  const parsed = updateCampaignSchema.safeParse(body)
  if (!parsed.success) return c.json({ success: false, error: 'Invalid campaign payload' }, 400)

  let nextBotId = existing.campaign.botId
  if (parsed.data.agent_id) {
    const bot = await findBotByAgentId(db, s, parsed.data.agent_id, parsed.data.clientId ?? existing.campaign.clientId)
    if (!bot) return c.json({ success: false, error: 'Invalid agent' }, 400)
    nextBotId = bot.id
  }

  if (parsed.data.clientId) {
    const client = (await db.select().from(clients).where(and(eq(clients.adminId, s.adminId), eq(clients.id, parsed.data.clientId))).limit(1))[0]
    if (!client) return c.json({ success: false, error: 'Invalid client' }, 400)
  }

  await updateCampaign(c.env, campaignId, s.adminId, {
    name: parsed.data.name ?? existing.campaign.name,
    clientId: parsed.data.clientId ?? existing.campaign.clientId,
    botId: nextBotId,
    description: parsed.data.description === undefined ? existing.campaign.description : parsed.data.description,
    languagesJson: parsed.data.languages ? JSON.stringify(parsed.data.languages) : existing.campaign.languagesJson,
    scheduledAt: parsed.data.scheduledAt === undefined ? existing.campaign.scheduledAt : parseOptionalDate(parsed.data.scheduledAt),
    updatedAt: new Date(),
  })

  const row = await getCampaignWithNames(c.env, db, s, campaignId)
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)
  return c.json({
    success: true,
    data: campaignToApi(row.campaign, {
      clientName: row.clientName,
      agentExternalRef: row.agentExternalRef,
      agentName: row.agentName,
    }),
  })
})

campaignsRoutes.get('/:campaignId/leads', async (c) => {
  const s = c.get('user')!
  const db = c.get('db')!
  const campaignId = c.req.param('campaignId')
  const queryBatchId = c.req.query('batchId')?.trim() || undefined
  const queryAgentId = c.req.query('agent')?.trim() || undefined
  const pgRef = parsePostgresCampaignId(campaignId)

  if (pgRef) {
    const data = await getPostgresCampaignApi(c.env, db, s, pgRef.agentId, pgRef.batchId)
    if (!data) return c.json({ success: false, error: 'Campaign not found' }, 404)
    const leads = await resolveCampaignLeads(c.env, s.adminId, pgRef.agentId, pgRef.batchId)
    return c.json({ success: true, data: { leads } })
  }

  const row = await getCampaignWithNames(c.env, db, s, campaignId)
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)

  let rows = await listLeads(c.env, s.adminId, row.campaign.id)
  if (row.campaign.status.toLowerCase() === 'failed') {
    const pendingIds = rows
      .filter((lead) => ['pending', 'processing'].includes(lead.callStatus.toLowerCase()))
      .map((lead) => lead.id)
    if (pendingIds.length > 0) {
      await setLeadsStatus(c.env, pendingIds, 'failed')
      rows = rows.map((lead) => (pendingIds.includes(lead.id) ? { ...lead, callStatus: 'failed' } : lead))
    }
  }

  if (rows.length > 0) {
    return c.json({ success: true, data: { leads: rows.map(leadToApi) } })
  }

  const statusRows = await listLeadStatuses(c.env, s.adminId, [row.campaign.id])
  const batchId = queryBatchId ?? statusRows.find((lead) => lead.upload_batch_id)?.upload_batch_id
  const agentId = queryAgentId ?? row.agentExternalRef
  if (batchId && agentId) {
    const pgLeads = await listPostgresLeadsByBatch(c.env, s.adminId, agentId, batchId)
    return c.json({ success: true, data: { leads: pgLeads.map(postgresLeadToApi) } })
  }

  return c.json({ success: true, data: { leads: [] } })
})

campaignsRoutes.post('/:campaignId/recreate', async (c) => {
  const s = c.get('user')!
  if (!canManageCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const db = c.get('db')!
  const existing = await getCampaignWithNames(c.env, db, s, c.req.param('campaignId'))
  if (!existing) return c.json({ success: false, error: 'Campaign not found' }, 404)

  const body = await c.req.json().catch(() => null)
  const parsed = recreateCampaignSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid recreate payload' }, 400)
  }

  const sourceLeads = await listLeads(c.env, s.adminId, existing.campaign.id)
  const eligibleLeads = sourceLeads.filter((lead) =>
    leadMatchesRetrySelection(lead, parsed.data.selection, parsed.data.shortCallThresholdSec),
  )

  if (eligibleLeads.length === 0) {
    return c.json({ success: false, error: 'No leads matched the selected retry criteria' }, 400)
  }

  const scheduledAt = parseOptionalDate(parsed.data.scheduledAt) ?? new Date(Date.now() + 60 * 60 * 1000)
  const now = new Date()
  const newCampaignId = crypto.randomUUID()
  const newBatchId = newCampaignId
  const newCampaignName = parsed.data.name?.trim() || `${existing.campaign.name} Retry`

  await insertCampaign(c.env, {
    id: newCampaignId,
    adminId: existing.campaign.adminId,
    clientId: existing.campaign.clientId,
    botId: existing.campaign.botId,
    name: newCampaignName,
    description: existing.campaign.description,
    status: 'importing',
    languagesJson: existing.campaign.languagesJson,
    columnsSchemaJson: existing.campaign.columnsSchemaJson,
    scheduledAt,
    createdAt: now,
    updatedAt: now,
  })

  const insertedLeadIds: string[] = []
  const cases: Array<{
    reference_id: string
    batch_id: string
    party_name: string
    party_mobile_number: string
    agent_id?: string
    client_name?: string
    preferred_language?: string
    emi_amount?: string | null
    emi_date?: string | null
    loan_type?: string | null
    meta_json?: Record<string, unknown>
  }> = []

  for (const lead of eligibleLeads) {
    const nextLeadId = crypto.randomUUID()
    const previousExtra = parseJson<Record<string, unknown>>(lead.extraDataJson, {})
    const previousDurationSec = extractShortCallDurationSeconds(lead)
    const retryMeta = {
      sourceCampaignId: existing.campaign.id,
      sourceLeadId: lead.id,
      previousStatus: lead.callStatus,
      previousDurationSec,
      retrySelection: parsed.data.selection,
      shortCallThresholdSec: parsed.data.shortCallThresholdSec,
      recreatedAt: now.toISOString(),
    }

    await insertLead(c.env, {
      id: nextLeadId,
      adminId: lead.adminId,
      clientId: lead.clientId,
      campaignId: newCampaignId,
      botId: lead.botId,
      referenceId: lead.referenceId,
      partyName: lead.partyName,
      partyMobile: lead.partyMobile,
      emiAmount: lead.emiAmount,
      emiDate: lead.emiDate,
      loanType: lead.loanType,
      preferredLanguage: lead.preferredLanguage,
      dataJson: lead.dataJson,
      extraDataJson: JSON.stringify({ ...previousExtra, retry_meta: retryMeta }),
      callStatus: 'pending',
      scheduledAt,
      fileName: lead.fileName,
      uploadBatchId: newBatchId,
      createdAt: now,
    })
    insertedLeadIds.push(nextLeadId)

    cases.push({
      reference_id: lead.referenceId,
      batch_id: newBatchId,
      agent_id: existing.agentExternalRef || existing.campaign.botId,
      client_name: existing.clientName,
      party_name: lead.partyName ?? '',
      party_mobile_number: lead.partyMobile ?? '',
      preferred_language: lead.preferredLanguage ?? undefined,
      emi_amount: lead.emiAmount,
      emi_date: lead.emiDate,
      loan_type: lead.loanType,
      meta_json: {
        ...parseJson<Record<string, unknown>>(lead.dataJson, {}),
        ...parseJson<Record<string, unknown>>(lead.extraDataJson, {}),
        retry_meta: retryMeta,
      },
    })
  }

  try {
    await dumpCampaignBatchToPostgres(c.env, {
      admin_id: s.adminId,
      batch_id: newBatchId,
      client_id: existing.campaign.clientId,
      client_name: existing.clientName,
      bot_id: existing.agentExternalRef || existing.campaign.botId,
      cases,
    })

    await updateCampaignImportMetadata(c.env, newCampaignId, s.adminId, {
      columnsSchemaJson: existing.campaign.columnsSchemaJson,
      scheduledAt,
      status: 'pending',
      updatedAt: new Date(),
    })
  } catch (error) {
    if (insertedLeadIds.length > 0) {
      await setLeadsStatus(c.env, insertedLeadIds, 'failed')
    }
    await updateCampaignImportMetadata(c.env, newCampaignId, s.adminId, {
      columnsSchemaJson: existing.campaign.columnsSchemaJson,
      scheduledAt,
      status: 'failed',
      updatedAt: new Date(),
    })
    throw error
  }

  const created = await getCampaignWithNames(c.env, db, s, newCampaignId)
  if (!created) {
    return c.json({ success: false, error: 'Retry campaign created but could not be loaded' }, 500)
  }

  return c.json({
    success: true,
    data: campaignToApi(
      created.campaign,
      {
        clientName: created.clientName,
        agentExternalRef: created.agentExternalRef,
        agentName: created.agentName,
      },
      eligibleLeads.map((lead) => ({ callStatus: lead.callStatus, uploadBatchId: newBatchId })),
    ),
    meta: {
      sourceCampaignId: existing.campaign.id,
      selectedLeadCount: eligibleLeads.length,
    },
  })
})

/** Same JSON the scheduler POSTs to `call_customers`; resolved URL is per-admin (D1 `ml_api_url` or env `ML_API_URL_*`). */
campaignsRoutes.get('/:campaignId/ml-preview', async (c) => {
  const s = c.get('user')!
  if (!canManageCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const db = c.get('db')!
  const row = await getCampaignWithNames(c.env, db, s, c.req.param('campaignId'))
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)

  const [leads, adminMlRow] = await Promise.all([
    getPendingLeads(c.env, row.campaign.id),
    db
      .select({
        mlApiUrl: admins.mlApiUrl,
        datasourceBinding: admins.datasourceBinding,
        slug: admins.slug,
      })
      .from(admins)
      .where(eq(admins.id, row.campaign.adminId))
      .limit(1),
  ])

  const botRow = (
    await db.select({ externalRef: bots.externalRef }).from(bots).where(eq(bots.id, row.campaign.botId)).limit(1)
  )[0]
  const botId = botRow?.externalRef ?? row.campaign.botId
  let mlBatchId: string
  try {
    mlBatchId = resolveMlBatchId(row.campaign.id, leads)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ success: false, error: message }, 400)
  }
  const resolvedMlUrl = resolveMlApiUrlForAdmin(c.env, adminMlRow[0])
  const payload = {
    bot_id: botId,
    batch_id: mlBatchId,
    expected_count: leads.length,
  }

  return c.json({
    success: true,
    data: {
      mlApiUrl: resolvedMlUrl,
      mlApiUrlConfigured: Boolean(resolvedMlUrl),
      mlBatchId,
      campaignId: row.campaign.id,
      pendingLeadCount: leads.length,
      payload,
    },
  })
})

campaignsRoutes.get('/:campaignId/sample', async (c) => {
  const s = c.get('user')!
  if (!canViewCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const db = c.get('db')!
  const row = await getCampaignWithNames(c.env, db, s, c.req.param('campaignId'))
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)

  const columns = parseJson<ColumnSchema[]>(row.campaign.columnsSchemaJson, requiredColumns)
  const sample = `${columns.map((column) => column.label).join(',')}\n${columns.map(() => '').join(',')}\n${columns.map(() => '').join(',')}\n`
  return new Response(sample, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${row.campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-sample.csv"`,
      'Cache-Control': 'no-cache',
    },
  })
})

campaignsRoutes.post('/:campaignId/import', async (c) => {
  const s = c.get('user')!
  if (!canManageCampaigns(s.role)) {
    return c.json({ success: false, error: 'Forbidden' }, 403)
  }
  const db = c.get('db')!
  const row = await getCampaignWithNames(c.env, db, s, c.req.param('campaignId'))
  if (!row) return c.json({ success: false, error: 'Campaign not found' }, 404)

  try {
    const formData = await c.req.formData()
    const file = formData.get('file')
    const scheduleDateTime = formData.get('scheduleDateTime')?.toString()
    if (!(file instanceof File)) return c.json({ success: false, error: 'No file provided' }, 400)

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension !== 'csv' && file.type !== 'text/csv') {
      return c.json({ success: false, error: 'Only CSV import is currently supported' }, 400)
    }

    const parseResult = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      transform: (value) => value.trim()
    })
    
    if (parseResult.errors.length > 0) {
      return c.json({ success: false, error: 'Failed to parse CSV. Please ensure it is correctly formatted.' }, 400)
    }
    
    const data = parseResult.data
    if (data.length === 0) return c.json({ success: false, error: 'File is empty' }, 400)

    const headers = Object.keys(data[0] ?? {})
    const nextColumns = columnsFromHeaders(headers)
    const mapping = buildHeaderMapping(headers, nextColumns)
    const missing = requiredColumns.filter((column) => !mapping.has(column.key))
    if (missing.length > 0) {
      return c.json({ success: false, error: `Missing required columns: ${missing.map((column) => column.label).join(', ')}` }, 400)
    }

    const scheduledAt = parseOptionalDate(scheduleDateTime) ?? row.campaign.scheduledAt
    const batchHeader = mapping.get('batch_id')
    let csvBatchId: string | null = null
    for (const item of data) {
      const cell = batchHeader ? item[batchHeader]?.trim() : ''
      if (!cell) continue
      if (csvBatchId === null) csvBatchId = cell
      else if (csvBatchId !== cell) {
        return c.json(
          {
            success: false,
            error:
              'CSV batch_id mismatch: every row must use the same batch_id (or leave batch_id empty so we use the campaign id as the operational batch_id).',
          },
          400,
        )
      }
    }
    const mlBatchId = csvBatchId ?? row.campaign.id
    const optionalColumns = nextColumns.filter((column) => !requiredColumns.some((required) => required.key === column.key))
    let successCount = 0
    let errorCount = 0
    const errors: string[] = []
    const insertedLeadIds: string[] = []
    const cases: Array<{
      reference_id: string
      batch_id: string
      party_name: string
      party_mobile_number: string
      agent_id?: string
      client_name?: string
      preferred_language?: string
      emi_amount?: string | null
      emi_date?: string | null
      loan_type?: string | null
      meta_json?: Record<string, unknown>
    }> = []

    await updateCampaignImportMetadata(c.env, row.campaign.id, s.adminId, {
      columnsSchemaJson: JSON.stringify(nextColumns),
      scheduledAt,
      status: 'importing',
      updatedAt: new Date(),
    })

    for (const item of data) {
      const referenceHeader = mapping.get('reference_id')
      let referenceId = referenceHeader ? item[referenceHeader]?.trim() : ''
      if (!referenceId) {
        referenceId = crypto.randomUUID()
      }

      const dataJson: Record<string, string> = {}
      const extraDataJson: Record<string, string> = {}
      const mappedHeaders = new Set<string>(mapping.values())
      
      const agentHeader = mapping.get('agent_id')
      const rowAgentId = (agentHeader ? item[agentHeader]?.trim() : '') || row.agentExternalRef || row.campaign.botId

      const clientHeader = mapping.get('client_name')
      const rowClientName = (clientHeader ? item[clientHeader]?.trim() : '') || row.clientName

      const emiAmount = mapping.get('emi_amount') ? item[mapping.get('emi_amount')!]?.trim() || null : null
      const emiDate = mapping.get('emi_date') ? item[mapping.get('emi_date')!]?.trim() || null : null
      const loanType = mapping.get('loan_type') ? item[mapping.get('loan_type')!]?.trim() || null : null
      const preferredLanguage = mapping.get('preferred_language') ? item[mapping.get('preferred_language')!]?.trim() || null : null

      for (const column of optionalColumns) {
        const header = mapping.get(column.key)
        if (header) dataJson[column.key] = item[header] ?? ''
      }

      for (const header of headers) {
        if (!mappedHeaders.has(header)) extraDataJson[normalizeKey(header)] = item[header] ?? ''
      }

      try {
        const leadId = crypto.randomUUID()
        await insertLead(c.env, {
          id: leadId,
          adminId: s.adminId,
          clientId: row.campaign.clientId,
          campaignId: row.campaign.id,
          botId: row.campaign.botId,
          referenceId,
          partyName: item[mapping.get('party_name')!]?.trim() || null,
          partyMobile: item[mapping.get('party_mobile_number')!]?.trim() || null,
          emiAmount,
          emiDate,
          loanType,
          preferredLanguage,
          dataJson: JSON.stringify(dataJson),
          extraDataJson: JSON.stringify(extraDataJson),
          callStatus: 'pending',
          scheduledAt,
          fileName: file.name,
          uploadBatchId: mlBatchId,
          createdAt: new Date(),
        })
        insertedLeadIds.push(leadId)
        cases.push({
          reference_id: referenceId,
          batch_id: mlBatchId,
          agent_id: rowAgentId,
          client_name: rowClientName,
          party_name: item[mapping.get('party_name')!]?.trim() || '',
          party_mobile_number: item[mapping.get('party_mobile_number')!]?.trim() || '',
          preferred_language: preferredLanguage ?? undefined,
          emi_amount: emiAmount,
          emi_date: emiDate,
          loan_type: loanType,
          meta_json: { ...dataJson, ...extraDataJson },
        })
        successCount++
      } catch (e) {
        errorCount++
        console.warn(`[campaigns.import] skipped row ${referenceId}:`, e)
        if (errors.length < 20) errors.push(`${referenceId}: Could not import this row. Please check the values and try again.`)
      }
    }

    try {
      if (cases.length > 0) {
        await dumpCampaignBatchToPostgres(c.env, {
          admin_id: s.adminId,
          batch_id: mlBatchId,
          client_id: row.campaign.clientId,
          client_name: row.clientName,
          bot_id: row.agentExternalRef || row.campaign.botId,
          cases,
        })
      }

      await updateCampaignImportMetadata(c.env, row.campaign.id, s.adminId, {
        columnsSchemaJson: JSON.stringify(nextColumns),
        scheduledAt,
        status: successCount > 0 ? 'pending' : 'failed',
        updatedAt: new Date(),
      })
    } catch (error) {
      if (isTruthyFlag(c.env.POSTGRES_DUMP_OPTIONAL)) {
        console.warn(
          `[campaigns.import] Postgres mirror skipped for campaign ${row.campaign.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        await updateCampaignImportMetadata(c.env, row.campaign.id, s.adminId, {
          columnsSchemaJson: JSON.stringify(nextColumns),
          scheduledAt,
          status: 'failed',
          updatedAt: new Date(),
        })
        return c.json({
          success: true,
          message: 'File processed successfully',
          data: {
            campaign_id: row.campaign.id,
            batch_id: mlBatchId,
            processedCount: data.length,
            successCount,
            errorCount,
            errors,
            postgresDumpSkipped: true,
            warning:
              'Leads were saved, but lead syncing is not fully configured. Please contact support before running this campaign.',
          },
        })
      }

      if (insertedLeadIds.length > 0) {
        await setLeadsStatus(c.env, insertedLeadIds, 'failed')
      }
      await updateCampaignImportMetadata(c.env, row.campaign.id, s.adminId, {
        columnsSchemaJson: JSON.stringify(nextColumns),
        scheduledAt,
        status: 'failed',
        updatedAt: new Date(),
      })
      throw error
    }

    return c.json({
      success: true,
      message: 'File processed successfully',
      data: {
        campaign_id: row.campaign.id,
        batch_id: mlBatchId,
        processedCount: data.length,
        successCount,
        errorCount,
        errors,
      },
    })
  } catch (e) {
    console.error('[campaigns.import] failed:', e)
    return c.json(
      {
        success: false,
        error: 'Lead import failed. Please check the CSV and try again.',
        code: 'CAMPAIGN_IMPORT_FAILED',
      },
      500
    )
  }
})
