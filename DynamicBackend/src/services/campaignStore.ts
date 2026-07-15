import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { createDb } from '../db'
import { campaignLeads, campaigns } from '../db/schema'
import type { AppEnv } from '../types'

export type CampaignRow = typeof campaigns.$inferSelect
export type LeadRow = typeof campaignLeads.$inferSelect
export type CampaignInsert = typeof campaigns.$inferInsert
export type LeadInsert = typeof campaignLeads.$inferInsert

function db(env: AppEnv['Bindings']) {
  return createDb(env.DB)
}

export async function insertCampaign(env: AppEnv['Bindings'], campaign: CampaignInsert) {
  await db(env).insert(campaigns).values(campaign)
}

export async function getCampaignById(env: AppEnv['Bindings'], adminId: string, campaignId: string, clientId?: string) {
  return (
    await db(env)
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.adminId, adminId),
          eq(campaigns.id, campaignId),
          clientId ? eq(campaigns.clientId, clientId) : undefined
        )
      )
      .limit(1)
  )[0] ?? null
}

export async function listCampaigns(env: AppEnv['Bindings'], adminId: string, clientId?: string) {
  return db(env)
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.adminId, adminId), clientId ? eq(campaigns.clientId, clientId) : undefined))
    .orderBy(desc(campaigns.updatedAt), desc(campaigns.createdAt))
}

export async function updateCampaign(
  env: AppEnv['Bindings'],
  campaignId: string,
  adminId: string,
  values: Pick<CampaignRow, 'name' | 'clientId' | 'botId' | 'description' | 'languagesJson' | 'scheduledAt' | 'updatedAt'>
) {
  await db(env).update(campaigns).set(values).where(and(eq(campaigns.adminId, adminId), eq(campaigns.id, campaignId)))
}

export async function updateCampaignImportMetadata(
  env: AppEnv['Bindings'],
  campaignId: string,
  adminId: string,
  values: { columnsSchemaJson: string; scheduledAt: Date | null; status: string; updatedAt: Date }
) {
  await db(env).update(campaigns).set(values).where(and(eq(campaigns.adminId, adminId), eq(campaigns.id, campaignId)))
}

export async function insertLead(env: AppEnv['Bindings'], lead: LeadInsert) {
  await db(env).insert(campaignLeads).values(lead)
}

export async function listLeads(env: AppEnv['Bindings'], adminId: string, campaignId: string) {
  return db(env)
    .select()
    .from(campaignLeads)
    .where(and(eq(campaignLeads.adminId, adminId), eq(campaignLeads.campaignId, campaignId)))
    .orderBy(desc(campaignLeads.createdAt))
}

export async function listLeadStatuses(env: AppEnv['Bindings'], adminId: string, campaignIds: string[]) {
  if (campaignIds.length === 0) return []
  return db(env)
    .select({
      campaign_id: campaignLeads.campaignId,
      call_status: campaignLeads.callStatus,
      upload_batch_id: campaignLeads.uploadBatchId,
    })
    .from(campaignLeads)
    .where(and(eq(campaignLeads.adminId, adminId), inArray(campaignLeads.campaignId, campaignIds)))
}

export async function getSchedulerCandidates(env: AppEnv['Bindings'], now: Date) {
  return db(env)
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.status, 'pending'), or(lte(campaigns.scheduledAt, now), isNull(campaigns.scheduledAt))))
}

export async function getPendingLeads(env: AppEnv['Bindings'], campaignId: string) {
  return db(env)
    .select()
    .from(campaignLeads)
    .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.callStatus, 'pending')))
}

/**
 * Single operational `batch_id` for Postgres + ML: stored on every lead as `upload_batch_id`.
 * Must match across all leads; throws if the campaign has inconsistent values (data bug).
 */
export function resolveMlBatchId(campaignId: string, leads: LeadRow[]): string {
  if (leads.length === 0) return campaignId
  const normalized = leads.map((l) => l.uploadBatchId?.trim() ?? '')
  if (normalized.some((b) => !b)) {
    throw new Error(
      `Campaign ${campaignId}: one or more leads are missing upload_batch_id (operational batch_id). Re-import the CSV.`,
    )
  }
  const first = normalized[0]
  const bad = normalized.find((b) => b !== first)
  if (bad !== undefined) {
    throw new Error(
      `Campaign ${campaignId}: leads have mixed batch_id values ("${first}" vs "${bad}"). Use one batch per campaign.`,
    )
  }
  return first
}

export async function setCampaignStatus(env: AppEnv['Bindings'], campaignId: string, status: string, scheduledAt?: Date | null) {
  const values: Partial<CampaignRow> = { status, updatedAt: new Date() }
  if (scheduledAt !== undefined) values.scheduledAt = scheduledAt
  await db(env).update(campaigns).set(values).where(eq(campaigns.id, campaignId))
}

export async function setLeadsStatus(env: AppEnv['Bindings'], leadIds: string[], status: string) {
  if (leadIds.length === 0) return
  const chunkSize = 100
  for (let index = 0; index < leadIds.length; index += chunkSize) {
    const chunk = leadIds.slice(index, index + chunkSize)
    await db(env).update(campaignLeads).set({ callStatus: status }).where(inArray(campaignLeads.id, chunk))
  }
}

export async function findLeadByCampaignReference(env: AppEnv['Bindings'], campaignId: string, referenceId: string) {
  return (
    await db(env)
      .select()
      .from(campaignLeads)
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.referenceId, referenceId)))
      .limit(1)
  )[0] ?? null
}

export async function findLeadByBatchOrCampaignReference(env: AppEnv['Bindings'], batchId: string, referenceId: string) {
  return (
    await db(env)
      .select()
      .from(campaignLeads)
      .where(
        and(
          or(eq(campaignLeads.campaignId, batchId), eq(campaignLeads.uploadBatchId, batchId)),
          eq(campaignLeads.referenceId, referenceId)
        )
      )
      .limit(1)
  )[0] ?? null
}

export async function updateLeadWebhook(env: AppEnv['Bindings'], leadId: string, status: string, extraDataJson: string) {
  await db(env).update(campaignLeads).set({ callStatus: status, extraDataJson }).where(eq(campaignLeads.id, leadId))
}

export async function refreshCampaignStatus(env: AppEnv['Bindings'], campaignId: string) {
  const rows = await db(env).select({ callStatus: campaignLeads.callStatus }).from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId))
  const nextStatus =
    rows.length === 0 || rows.every((row) => !['pending', 'processing'].includes(row.callStatus.toLowerCase()))
      ? 'completed'
      : 'live'
  await setCampaignStatus(env, campaignId, nextStatus)
  return nextStatus
}

export async function getCampaignStatuses(env: AppEnv['Bindings'], campaignIds: string[]) {
  if (campaignIds.length === 0) return []
  return db(env).select({ id: campaigns.id, status: campaigns.status }).from(campaigns).where(inArray(campaigns.id, campaignIds))
}
