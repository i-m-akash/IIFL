import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../db'
import { admins } from '../db/schema'
import type { AppEnv } from '../types'
import {
  findLeadByBatchOrCampaignReference,
  getCampaignStatuses,
  refreshCampaignStatus,
  updateLeadWebhook,
} from '../services/campaignStore'

function normalizeCallStatus(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (['completed', 'complete', 'answered', 'success'].includes(raw)) return 'completed'
  if (['ptp', 'promise_to_pay', 'promise to pay'].includes(raw)) return 'ptp'
  if (['failed', 'failure', 'error', 'dropped'].includes(raw)) return 'failed'
  if (['busy'].includes(raw)) return 'busy'
  if (['processing', 'in_progress', 'in progress', 'queued'].includes(raw)) return 'processing'
  if (['no_response', 'no response', 'unanswered'].includes(raw)) return 'no_response'
  return raw.replace(/\s+/g, '_')
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function extractWebhookUpdates(body: unknown) {
  const root = toRecord(body)
  const batchId =
    String(
      root?.batch_id ??
        root?.batchId ??
        root?.campaign_id ??
        root?.campaignId ??
        ''
    ).trim() || null

  const candidates = Array.isArray(body)
    ? body
    : Array.isArray(root?.results)
      ? root?.results
      : Array.isArray(root?.cases)
        ? root?.cases
        : Array.isArray(root?.calls)
          ? root?.calls
          : root
            ? [root]
            : []

  const updates = candidates
    .map((item) => {
      const row = toRecord(item)
      if (!row) return null

      const referenceId = String(row.reference_id ?? row.referenceId ?? row.case_id ?? row.caseId ?? '').trim()
      const status = normalizeCallStatus(row.call_status ?? row.callStatus ?? row.status ?? row.outcome ?? row.disposition)
      const itemBatchId = String(row.batch_id ?? row.batchId ?? batchId ?? '').trim()

      if (!referenceId || !status || !itemBatchId) return null

      return {
        batchId: itemBatchId,
        referenceId,
        status,
        payload: row,
      }
    })
    .filter((item): item is { batchId: string; referenceId: string; status: string; payload: Record<string, unknown> } => !!item)

  return { batchId, updates }
}

export const publicRoutes = new Hono<AppEnv>()

publicRoutes.get('/admin/:slug', async (c) => {
  const slug = c.req.param('slug')
  const db = createDb(c.env.DB)
  const admin = (await db.select().from(admins).where(eq(admins.slug, slug)).limit(1))[0]
  if (!admin) {
    return c.json({ success: false, error: 'Unknown admin' }, 404)
  }
  return c.json({
    success: true,
    data: {
      adminSlug: admin.slug,
      adminName: admin.name,
      slug: admin.slug,
      name: admin.name,
      logoUrl: admin.logoUrl,
      primaryColor: admin.primaryColor,
      secondaryColor: admin.secondaryColor,
      navBgColor: admin.navBgColor,
      fontFamily: admin.fontFamily,
    },
  })
})

publicRoutes.post('/campaign-webhook', async (c) => {
  const body = await c.req.json().catch(() => null)
  const { updates } = extractWebhookUpdates(body)

  if (updates.length === 0) {
    return c.json({ success: false, error: 'No valid webhook updates found' }, 400)
  }

  const touchedCampaignIds = new Set<string>()
  const applied: Array<{ batchId: string; referenceId: string; status: string }> = []

  for (const update of updates) {
    const lead = await findLeadByBatchOrCampaignReference(c.env, update.batchId, update.referenceId)

    if (!lead) continue

    let extraData: Record<string, unknown> = {}
    try {
      extraData = lead.extraDataJson ? (JSON.parse(lead.extraDataJson) as Record<string, unknown>) : {}
    } catch {
      extraData = {}
    }

    await updateLeadWebhook(
      c.env,
      lead.id,
      update.status,
      JSON.stringify({
        ...extraData,
        webhook: update.payload,
      })
    )

    touchedCampaignIds.add(lead.campaignId ?? update.batchId)
    applied.push({ batchId: update.batchId, referenceId: update.referenceId, status: update.status })
  }

  for (const campaignId of touchedCampaignIds) {
    await refreshCampaignStatus(c.env, campaignId)
  }

  const campaignIdList = Array.from(touchedCampaignIds)
  if (campaignIdList.length > 0) {
    const liveCampaigns = await getCampaignStatuses(c.env, campaignIdList)

    return c.json({
      success: true,
      data: {
        applied,
        campaigns: liveCampaigns,
      },
    })
  }

  return c.json({
    success: true,
    data: {
      applied,
      campaigns: [],
    },
  })
})
