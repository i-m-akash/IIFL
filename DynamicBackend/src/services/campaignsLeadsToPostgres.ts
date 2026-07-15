import postgres from 'postgres'
import type { Sql } from 'postgres'
import type { AppEnv } from '../types'
import { createDb } from '../db'
import { admins } from '../db/schema'
import { eq } from 'drizzle-orm'
import {
  formatPostgresWriteSetupHint,
  isPostgresPermissionDenied,
  maskPostgresUrl,
  resolvePostgresWriteUrl,
} from './postgresConnection'

type VoicebotLeadCase = {
  reference_id: string
  batch_id?: string
  party_name: string
  party_mobile_number: string
  agent_id?: string
  client_name?: string
  preferred_language?: string
  emi_amount?: string | null
  emi_date?: string | null
  loan_type?: string | null
  meta_json?: Record<string, unknown>
}

type VoicebotDumpPayload = {
  admin_id: string
  batch_id: string
  client_id: string
  client_name: string
  bot_id: string
  cases: VoicebotLeadCase[]
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function closeSqlClient(sql: Sql, viaHyperdrive: boolean) {
  if (viaHyperdrive) return
  try {
    await sql.end({ timeout: 5 })
  } catch (error) {
    console.warn('Postgres end error:', error)
  }
}

function parseEmiAmount(value: string | null | undefined) {
  if (value == null || value.trim() === '') return null
  const normalized = value.replace(/,/g, '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function verifyPostgresBatchLeads(
  sql: Sql,
  schemaName: string,
  tableName: string,
  campaignBatchId: string,
  cases: VoicebotLeadCase[],
) {
  const uniqueBatchIds = [...new Set(cases.map(c => c.batch_id || campaignBatchId))]
  
  if (uniqueBatchIds.length === 1) {
    const expectedBatchId = uniqueBatchIds[0]
    const countRows = (await withTimeout(sql.unsafe(
      `SELECT count(*)::int AS c FROM ${schemaName}.${tableName} WHERE batch_id = $1`,
      [expectedBatchId],
    ), 35000, 'Verify batch count')) as { c: number }[]
    const actual = countRows[0]?.c ?? 0
    if (actual >= cases.length) return
  }

  for (const lead of cases) {
    const expectedBatchId = lead.batch_id || campaignBatchId
    const existing = (await withTimeout(sql.unsafe(
      `SELECT reference_id, batch_id FROM ${schemaName}.${tableName} WHERE reference_id = $1 LIMIT 1`,
      [lead.reference_id],
    ), 35000, `Verify lead ${lead.reference_id}`)) as { reference_id: string; batch_id: string }[]

    if (existing[0] && existing[0].batch_id !== expectedBatchId) {
      throw new Error(
        `Lead reference_id "${lead.reference_id}" already exists in ${schemaName}.${tableName} under batch_id "${existing[0].batch_id}". ` +
          `This row tried to use batch_id "${expectedBatchId}". If ML or reporting filters by batch_id, align CSV batch_id with existing rows. ` +
          `Use a new reference_id in the CSV, remove the old Postgres row, or ask DE for UPDATE on dump_lead_info.`,
      )
    }
  }

  if (uniqueBatchIds.length === 1) {
    throw new Error(
      `Not all lead(s) out of ${cases.length} exist in ${schemaName}.${tableName} for batch_id "${uniqueBatchIds[0]}". ` +
        `Import may have been skipped due to duplicate reference_id (ON CONFLICT DO NOTHING).`,
    )
  }
}



export async function dumpCampaignBatchToPostgres(env: AppEnv['Bindings'], payload: VoicebotDumpPayload) {
  const db = createDb(env.DB)
  const adminRow = (await db.select().from(admins).where(eq(admins.id, payload.admin_id)).limit(1))[0]
  if (!adminRow) throw new Error(`Admin not found: ${payload.admin_id}`)

  const datasourceBinding = adminRow.datasourceBinding ?? null
  const resolved = resolvePostgresWriteUrl(env, datasourceBinding)
  if (!resolved) {
    throw new Error(
      `No Postgres write connection for '${datasourceBinding ?? 'unset'}'. ${formatPostgresWriteSetupHint(datasourceBinding)}`,
    )
  }

  const urlKey = `${datasourceBinding}_URL`
  const hasDirectUrl = typeof env[urlKey] === 'string' && (env[urlKey] as string).trim().length > 0
  console.log(
    `[voicebotDump] Postgres write: ${resolved.viaHyperdrive ? 'hyperdrive' : 'direct'} ` +
      `${maskPostgresUrl(resolved.url)} (env ${urlKey} ${hasDirectUrl ? 'set' : 'missing'})`,
  )

  const schemaName = adminRow.postgresSchema ?? 'public'
  const tableName = adminRow.postgresLeadTable ?? 'campaign_leads'

  const sql = postgres(resolved.url, {
    max: resolved.viaHyperdrive ? 3 : 1,
    connect_timeout: 30,
    idle_timeout: resolved.viaHyperdrive ? 20 : 5,
    prepare: false,
    ssl: resolved.viaHyperdrive ? false : 'require',
  })

  try {
    await withTimeout(sql.unsafe(`SELECT 1`), 10000, 'Database Connection Test (SELECT 1)')
    let shape: 'accelbiz' | 'iifl' | 'iifl_typo' | null = null

    const insertAccelbiz = async (lead: VoicebotLeadCase) => {
      const webhookUrl =
        typeof env.ACCELBIZ_DUMP_LEAD_WEBHOOK_URL === 'string' && env.ACCELBIZ_DUMP_LEAD_WEBHOOK_URL.trim().length > 0
          ? env.ACCELBIZ_DUMP_LEAD_WEBHOOK_URL.trim()
          : null
      const query = `
        INSERT INTO ${schemaName}.${tableName} (
          admin_id, reference_id, batch_id, client_name, agent_id,
          party_name, party_mobile_number, emi_amount, emi_date, loan_type,
          preferred_language, webhook_url, meta_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
        ON CONFLICT DO NOTHING
      `
      const values = [
        payload.admin_id,
        lead.reference_id,
        lead.batch_id || payload.batch_id,
        lead.client_name || payload.client_name || null,
        lead.agent_id || payload.bot_id || null,
        lead.party_name || null,
        lead.party_mobile_number || null,
        parseEmiAmount(lead.emi_amount ?? null),
        lead.emi_date || null,
        lead.loan_type || null,
        lead.preferred_language || null,
        webhookUrl,
        lead.meta_json ? JSON.stringify(lead.meta_json) : null,
      ]
      await withTimeout(sql.unsafe(query, values), 20000, `Insert lead ${lead.reference_id}`)
    }

    const insertIIFL = async (lead: VoicebotLeadCase, langCol: 'preferred_language' | 'preffered_language') => {
      const query = `
        INSERT INTO ${schemaName}.${tableName} (
          reference_id, batch_id, name, agent_id, client_name,
          mobile_number, ${langCol}, meta_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT DO NOTHING
      `
      const values = [
        lead.reference_id,
        lead.batch_id || payload.batch_id,
        lead.party_name || null,
        lead.agent_id || payload.bot_id || null,
        lead.client_name || payload.client_name || null,
        lead.party_mobile_number || null,
        lead.preferred_language || null,
        lead.meta_json ? JSON.stringify(lead.meta_json) : null,
      ]
      await withTimeout(sql.unsafe(query, values), 20000, `Insert lead ${lead.reference_id}`)
    }

    const determineShapeAndInsertFirst = async (lead: VoicebotLeadCase) => {
      try {
        await insertAccelbiz(lead)
        shape = 'accelbiz'
      } catch (err: any) {
        const msg = getErrorMessage(err)
        if (msg.includes('does not exist')) {
          try {
            await insertIIFL(lead, 'preferred_language')
            shape = 'iifl'
          } catch (err2: any) {
            const msg2 = getErrorMessage(err2)
            if (msg2.includes('does not exist') && msg2.includes('preferred_language')) {
              await insertIIFL(lead, 'preffered_language')
              shape = 'iifl_typo'
            } else {
              throw err2
            }
          }
        } else {
          throw err
        }
      }
    }

    for (let i = 0; i < payload.cases.length; i++) {
      const lead = payload.cases[i]
      if (shape === null) {
        await determineShapeAndInsertFirst(lead)
      } else {
        if (shape === 'accelbiz') {
          await insertAccelbiz(lead)
        } else if (shape === 'iifl') {
          await insertIIFL(lead, 'preferred_language')
        } else if (shape === 'iifl_typo') {
          await insertIIFL(lead, 'preffered_language')
        }
      }
    }

    await verifyPostgresBatchLeads(sql, schemaName, tableName, payload.batch_id, payload.cases)

    console.log(
      `[voicebotDump] Dumped ${payload.cases.length} lead(s) for batch ${payload.batch_id} into ${schemaName}.${tableName} (${shape})`,
    )

    return {
      mode: 'postgres' as const,
      batchId: payload.batch_id,
      insertedCount: payload.cases.length,
      tableShape: 'dynamic',
    }
  } catch (error) {
    const message = getErrorMessage(error)
    if (isPostgresPermissionDenied(error)) {
      throw new Error(`Postgres dump failed: ${message}. ${formatPostgresWriteSetupHint(datasourceBinding)}`)
    }
    throw new Error(`Postgres dump failed: ${message}`)
  } finally {
    await closeSqlClient(sql, resolved.viaHyperdrive)
  }
}

