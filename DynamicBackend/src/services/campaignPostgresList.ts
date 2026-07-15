import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { createDb } from '../db'
import { admins, bots } from '../db/schema'
import type { AppEnv } from '../types'
import { resolvePostgresReadUrl } from './postgresConnection'

export type PostgresCampaignCard = {
  batch_id: string
  client_name: string
  agent_id: string
  agent_name: string
  start_date: string
  end_date: string
  total_triggered: number
  answered_calls: number
  unanswered_calls: number
}

export function todayIstDateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Returns null when no date filter — list all campaigns. */
export function parseCampaignListDate(raw: string | undefined | null) {
  const value = raw?.trim()
  if (!value || value === 'all') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) {
    return value
  }
  return null
}

/** Pre-aggregated facts — much faster than joining facts per lead row. */
const ALL_CAMPAIGN_LIST_SQL: Record<'customer' | 'employee', string> = {
  customer: `WITH batches AS (
    SELECT batch_id, client_name, agent_id,
      MIN(created_at) AS created_at_min,
      MAX(created_at) AS created_at_max,
      COUNT(DISTINCT reference_id) AS total_triggered
    FROM vconnect_data.dump_lead_info
    WHERE agent_id = $1 AND COALESCE(batch_id, '') <> ''
    GROUP BY batch_id, client_name, agent_id
  ),
  answered AS (
    SELECT batch_id, agent_id, COUNT(DISTINCT call_uuid) AS answered_calls
    FROM vconnect_data.fact_answered_customer
    WHERE agent_id = $1
    GROUP BY batch_id, agent_id
  ),
  unanswered AS (
    SELECT batch_id, agent_id, COUNT(DISTINCT call_uuid) AS unanswered_calls
    FROM vconnect_data.fact_unanswered_calls
    WHERE agent_id = $1
    GROUP BY batch_id, agent_id
  )
  SELECT
    b.batch_id,
    b.client_name,
    b.created_at_min::date AS start_date,
    b.created_at_max::date AS end_date,
    b.total_triggered,
    COALESCE(a.answered_calls, 0) AS answered_calls,
    COALESCE(u.unanswered_calls, 0) AS unanswered_calls
  FROM batches b
  LEFT JOIN answered a ON a.batch_id = b.batch_id AND a.agent_id = b.agent_id
  LEFT JOIN unanswered u ON u.batch_id = b.batch_id AND u.agent_id = b.agent_id
  ORDER BY b.created_at_max DESC`,
  employee: `WITH batches AS (
    SELECT batch_id, client_name, agent_id,
      MIN(created_at) AS created_at_min,
      MAX(created_at) AS created_at_max,
      COUNT(DISTINCT reference_id) AS total_triggered
    FROM vconnect_data.dump_lead_info
    WHERE agent_id = $1 AND COALESCE(batch_id, '') <> ''
    GROUP BY batch_id, client_name, agent_id
  ),
  answered AS (
    SELECT batch_id, agent_id, COUNT(DISTINCT call_uuid) AS answered_calls
    FROM vconnect_data.fact_answered_employee
    WHERE agent_id = $1
    GROUP BY batch_id, agent_id
  ),
  unanswered AS (
    SELECT batch_id, agent_id, COUNT(DISTINCT call_uuid) AS unanswered_calls
    FROM vconnect_data.fact_unanswered_calls
    WHERE agent_id = $1
    GROUP BY batch_id, agent_id
  )
  SELECT
    b.batch_id,
    b.client_name,
    b.created_at_min::date AS start_date,
    b.created_at_max::date AS end_date,
    b.total_triggered,
    COALESCE(a.answered_calls, 0) AS answered_calls,
    COALESCE(u.unanswered_calls, 0) AS unanswered_calls
  FROM batches b
  LEFT JOIN answered a ON a.batch_id = b.batch_id AND a.agent_id = b.agent_id
  LEFT JOIN unanswered u ON u.batch_id = b.batch_id AND u.agent_id = b.agent_id
  ORDER BY b.created_at_max DESC`,
}

const BATCH_LEADS_DUMP_SQL = `SELECT
  reference_id,
  name AS party_name,
  mobile_number AS party_mobile_number,
  batch_id,
  preferred_language,
  created_at
FROM vconnect_data.dump_lead_info
WHERE agent_id = $1 AND batch_id = $2
ORDER BY created_at DESC`

const BATCH_LEADS_INFO_SQL = `SELECT
  reference_id,
  name AS party_name,
  mobile_number AS party_mobile_number,
  batch_id,
  preferred_language,
  created_at
FROM vconnect_data.lead_info
WHERE agent_id = $1 AND batch_id = $2
ORDER BY created_at DESC`

export type PostgresLeadRow = {
  reference_id: string
  party_name: string
  party_mobile_number: string
  batch_id: string
  preferred_language?: string
  created_at?: string
}

function listQueryKind(externalRef: string): 'customer' | 'employee' {
  return externalRef.includes('employee') ? 'employee' : 'customer'
}

export function postgresCampaignMetrics(card: PostgresCampaignCard) {
  const total = card.total_triggered
  const answered = card.answered_calls
  const unanswered = card.unanswered_calls
  return {
    total,
    totalTriggered: total,
    answered,
    unanswered,
    completed: answered,
    failed: unanswered,
    pending: Math.max(0, total - answered - unanswered),
    answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
  }
}

export const PG_CAMPAIGN_ID_PREFIX = 'pg|'

export function postgresCampaignId(agentId: string, batchId: string) {
  return `${PG_CAMPAIGN_ID_PREFIX}${agentId}|${batchId}`
}

export function parsePostgresCampaignId(id: string): { agentId: string; batchId: string } | null {
  if (!id.startsWith(PG_CAMPAIGN_ID_PREFIX)) return null
  const rest = id.slice(PG_CAMPAIGN_ID_PREFIX.length)
  const splitAt = rest.indexOf('|')
  if (splitAt <= 0) return null
  const agentId = rest.slice(0, splitAt).trim()
  const batchId = rest.slice(splitAt + 1).trim()
  if (!agentId || !batchId) return null
  return { agentId, batchId }
}

export function mergeCampaignKey(agentId: string, batchId: string) {
  return `${agentId}|${batchId}`
}

export async function listPostgresCampaignCards(
  env: AppEnv['Bindings'],
  adminId: string,
  dateKey: string | null,
  agentFilter?: string | null,
): Promise<PostgresCampaignCard[]> {
  const db = createDb(env.DB)
  const adminRow = (await db.select().from(admins).where(eq(admins.id, adminId)).limit(1))[0]
  if (!adminRow || (adminRow.analyticsSource ?? 'd1') !== 'hyperdrive_postgres') {
    return []
  }

  const resolved = resolvePostgresReadUrl(env, adminRow.datasourceBinding)
  if (!resolved) return []

  const botRows = await db
    .select({
      externalRef: bots.externalRef,
      name: bots.name,
      campaignListQuery: bots.campaignListQuery,
    })
    .from(bots)
    .where(eq(bots.adminId, adminId))

  const trimmedAgent = agentFilter?.trim()
  const queries = botRows
    .filter((bot) => bot.campaignListQuery?.trim())
    .filter((bot) => !trimmedAgent || bot.externalRef === trimmedAgent)
  if (queries.length === 0) return []

  const sql = postgres(resolved.url, {
    max: resolved.viaHyperdrive ? 5 : 2,
    idle_timeout: resolved.viaHyperdrive ? 20 : 5,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
  })

  const cards: PostgresCampaignCard[] = []

  try {
    const rowSets = await Promise.all(
      queries.map(async (bot) => {
        const rows = dateKey
          ? ((await sql.unsafe(bot.campaignListQuery!, [bot.externalRef, dateKey])) as Record<string, unknown>[])
          : ((await sql.unsafe(ALL_CAMPAIGN_LIST_SQL[listQueryKind(bot.externalRef)], [bot.externalRef])) as Record<
              string,
              unknown
            >[])
        return { bot, rows }
      }),
    )

    for (const { bot, rows } of rowSets) {
      for (const row of rows) {
        cards.push({
          batch_id: String(row.batch_id ?? ''),
          client_name: String(row.client_name ?? ''),
          agent_id: bot.externalRef,
          agent_name: bot.name,
          start_date: String(row.start_date ?? dateKey ?? ''),
          end_date: String(row.end_date ?? dateKey ?? ''),
          total_triggered: Number(row.total_triggered ?? 0),
          answered_calls: Number(row.answered_calls ?? 0),
          unanswered_calls: Number(row.unanswered_calls ?? 0),
        })
      }
    }
  } finally {
    if (!resolved.viaHyperdrive) {
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }

  return cards.filter((card) => card.batch_id.trim().length > 0)
}

export async function listPostgresLeadsByBatch(
  env: AppEnv['Bindings'],
  adminId: string,
  agentId: string,
  batchId: string,
): Promise<PostgresLeadRow[]> {
  const db = createDb(env.DB)
  const adminRow = (await db.select().from(admins).where(eq(admins.id, adminId)).limit(1))[0]
  if (!adminRow || (adminRow.analyticsSource ?? 'd1') !== 'hyperdrive_postgres') {
    return []
  }

  const resolved = resolvePostgresReadUrl(env, adminRow.datasourceBinding)
  if (!resolved) return []

  const sql = postgres(resolved.url, {
    max: resolved.viaHyperdrive ? 5 : 1,
    idle_timeout: resolved.viaHyperdrive ? 20 : 5,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
  })

  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.map((row) => ({
      reference_id: String(row.reference_id ?? ''),
      party_name: String(row.party_name ?? ''),
      party_mobile_number: String(row.party_mobile_number ?? ''),
      batch_id: String(row.batch_id ?? batchId),
      preferred_language: row.preferred_language ? String(row.preferred_language) : undefined,
      created_at: row.created_at ? String(row.created_at) : undefined,
    }))

  try {
    let rows = (await sql.unsafe(BATCH_LEADS_DUMP_SQL, [agentId, batchId])) as Record<string, unknown>[]
    if (rows.length === 0) {
      rows = (await sql.unsafe(BATCH_LEADS_INFO_SQL, [agentId, batchId])) as Record<string, unknown>[]
    }
    return mapRows(rows).filter((row) => row.reference_id.trim().length > 0)
  } finally {
    if (!resolved.viaHyperdrive) {
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }
}

const BATCH_CARD_SQL: Record<'customer' | 'employee', string> = {
  customer: `SELECT
    d.batch_id,
    d.client_name,
    MIN(d.created_at)::date AS start_date,
    MAX(d.created_at)::date AS end_date,
    COUNT(DISTINCT d.reference_id) AS total_triggered,
    COUNT(DISTINCT fac.call_uuid) AS answered_calls,
    COUNT(DISTINCT fuc.call_uuid) AS unanswered_calls
  FROM vconnect_data.dump_lead_info d
  LEFT JOIN vconnect_data.fact_answered_customer fac
    ON fac.batch_id = d.batch_id AND fac.agent_id = d.agent_id
  LEFT JOIN vconnect_data.fact_unanswered_calls fuc
    ON fuc.batch_id = d.batch_id AND fuc.agent_id = d.agent_id
  WHERE d.agent_id = $1 AND d.batch_id = $2
  GROUP BY d.batch_id, d.client_name
  LIMIT 1`,
  employee: `SELECT
    d.batch_id,
    d.client_name,
    MIN(d.created_at)::date AS start_date,
    MAX(d.created_at)::date AS end_date,
    COUNT(DISTINCT d.reference_id) AS total_triggered,
    COUNT(DISTINCT fae.call_uuid) AS answered_calls,
    COUNT(DISTINCT fuc.call_uuid) AS unanswered_calls
  FROM vconnect_data.dump_lead_info d
  LEFT JOIN vconnect_data.fact_answered_employee fae
    ON fae.batch_id = d.batch_id AND fae.agent_id = d.agent_id
  LEFT JOIN vconnect_data.fact_unanswered_calls fuc
    ON fuc.batch_id = d.batch_id AND fuc.agent_id = d.agent_id
  WHERE d.agent_id = $1 AND d.batch_id = $2
  GROUP BY d.batch_id, d.client_name
  LIMIT 1`,
}

function batchCardKind(externalRef: string): 'customer' | 'employee' {
  return externalRef.includes('employee') ? 'employee' : 'customer'
}

export async function getPostgresCampaignCardByBatch(
  env: AppEnv['Bindings'],
  adminId: string,
  agentId: string,
  batchId: string,
): Promise<PostgresCampaignCard | null> {
  const db = createDb(env.DB)
  const adminRow = (await db.select().from(admins).where(eq(admins.id, adminId)).limit(1))[0]
  if (!adminRow || (adminRow.analyticsSource ?? 'd1') !== 'hyperdrive_postgres') {
    return null
  }

  const resolved = resolvePostgresReadUrl(env, adminRow.datasourceBinding)
  if (!resolved) return null

  const bot = (
    await db
      .select({ externalRef: bots.externalRef, name: bots.name })
      .from(bots)
      .where(eq(bots.adminId, adminId))
  ).find((row) => row.externalRef === agentId)

  if (!bot) return null

  const sql = postgres(resolved.url, {
    max: resolved.viaHyperdrive ? 5 : 1,
    idle_timeout: resolved.viaHyperdrive ? 20 : 5,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
  })

  try {
    const query = BATCH_CARD_SQL[batchCardKind(agentId)]
    const rows = (await sql.unsafe(query, [agentId, batchId])) as Record<string, unknown>[]
    const row = rows[0]
    if (!row) return null

    return {
      batch_id: String(row.batch_id ?? batchId),
      client_name: String(row.client_name ?? ''),
      agent_id: agentId,
      agent_name: bot.name,
      start_date: String(row.start_date ?? ''),
      end_date: String(row.end_date ?? ''),
      total_triggered: Number(row.total_triggered ?? 0),
      answered_calls: Number(row.answered_calls ?? 0),
      unanswered_calls: Number(row.unanswered_calls ?? 0),
    }
  } finally {
    if (!resolved.viaHyperdrive) {
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }
}
