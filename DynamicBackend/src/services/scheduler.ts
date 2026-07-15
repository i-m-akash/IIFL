import { createDb } from '../db'
import { admins, bots } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { AppEnv } from '../types'
import {
  getPendingLeads,
  getSchedulerCandidates,
  resolveMlBatchId,
  setCampaignStatus,
  setLeadsStatus,
} from './campaignStore'
import { resolveMlApiUrlForAdmin } from './mlApiUrl'

/** Hours past `effectiveScheduledAt` after which a still-pending campaign is treated as stale (no ML dial). */
function maxPastDueHoursFromEnv(env: AppEnv['Bindings']): number {
  const defaultHours = 24
  const raw = env.SCHEDULER_MAX_PAST_DUE_HOURS
  if (raw !== undefined && String(raw).trim() !== '') {
    const n = Number(String(raw).trim())
    if (!Number.isFinite(n) || n < 0) return defaultHours
    return n // 0 = disable stale guard (legacy behavior: dial any overdue pending)
  }
  return defaultHours
}

export type SchedulerRunSummary = {
  now: string
  candidateCount: number
  triggeredCampaignIds: string[]
  skipped: Array<{ campaignId: string; reason: string }>
  failed: Array<{ campaignId: string; reason: string }>
}

export async function runCampaignScheduler(env: AppEnv['Bindings']) {
  const db = createDb(env.DB)
  const now = new Date()
  const summary: SchedulerRunSummary = {
    now: now.toISOString(),
    candidateCount: 0,
    triggeredCampaignIds: [],
    skipped: [],
    failed: [],
  }

  try {
    const candidateCampaigns = await getSchedulerCandidates(env, now)

    summary.candidateCount = candidateCampaigns.length

    if (candidateCampaigns.length === 0) {
      console.log('No pending scheduled campaigns to process.')
      return summary
    }

    console.log(`Found ${candidateCampaigns.length} pending campaign candidates to inspect.`)

    for (const campaign of candidateCampaigns) {
      try {
        const [botRow, leads, adminMlRow] = await Promise.all([
          db.select({ externalRef: bots.externalRef }).from(bots).where(eq(bots.id, campaign.botId)).limit(1),
          getPendingLeads(env, campaign.id),
          db
            .select({
              mlApiUrl: admins.mlApiUrl,
              datasourceBinding: admins.datasourceBinding,
              slug: admins.slug,
            })
            .from(admins)
            .where(eq(admins.id, campaign.adminId))
            .limit(1),
        ])

        const botExternalRef = botRow[0]?.externalRef ?? campaign.botId
        const adminRouting = adminMlRow[0]

        if (leads.length === 0) {
          console.log(`Campaign ${campaign.id} has no pending leads. Skipping.`)
          await setCampaignStatus(env, campaign.id, 'completed')
          summary.skipped.push({ campaignId: campaign.id, reason: 'no pending leads' })
          continue
        }

        const leadScheduleCandidates = leads
          .map((lead) => lead.scheduledAt)
          .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
          .sort((a, b) => a.getTime() - b.getTime())

        const effectiveScheduledAt = campaign.scheduledAt ?? leadScheduleCandidates[0] ?? null

        if (!effectiveScheduledAt) {
          console.log(`Campaign ${campaign.id} has no schedule on campaign or leads. Skipping.`)
          summary.skipped.push({ campaignId: campaign.id, reason: 'no schedule on campaign or leads' })
          continue
        }

        if (effectiveScheduledAt.getTime() > now.getTime()) {
          console.log(
            `Campaign ${campaign.id} scheduled for ${effectiveScheduledAt.toISOString()}, current time ${now.toISOString()}. Skipping for now.`
          )
          summary.skipped.push({
            campaignId: campaign.id,
            reason: `scheduled for future time ${effectiveScheduledAt.toISOString()}`,
          })
          continue
        }

        const maxPastHours = maxPastDueHoursFromEnv(env)
        if (maxPastHours > 0) {
          const ageMs = now.getTime() - effectiveScheduledAt.getTime()
          const maxMs = maxPastHours * 60 * 60 * 1000
          if (ageMs > maxMs) {
            const msg = `Schedule ${effectiveScheduledAt.toISOString()} is more than ${maxPastHours}h past due; not dialing ML (stale pending). Marking failed — update schedule or re-import if this should still run.`
            console.log(`Campaign ${campaign.id}: ${msg}`)
            await setLeadsStatus(
              env,
              leads.map((l) => l.id),
              'failed',
            )
            await setCampaignStatus(env, campaign.id, 'failed')
            summary.skipped.push({ campaignId: campaign.id, reason: 'stale schedule past max past-due window' })
            continue
          }
        }

        // Mark campaign as 'live' only after it is confirmed eligible to prevent duplicate processing.
        await setCampaignStatus(env, campaign.id, 'live', effectiveScheduledAt)

        const mlBatchId = resolveMlBatchId(campaign.id, leads)
        /** Single ML endpoint: server resolves leads by `batch_id` + `bot_id` from its Postgres. */
        const payload = {
          bot_id: botExternalRef || campaign.botId,
          batch_id: mlBatchId,
          expected_count: leads.length,
        }

        const mlApiUrl = resolveMlApiUrlForAdmin(env, adminRouting)

        if (mlApiUrl) {
          console.log(
            `Triggering ML API for campaign ${campaign.id} with ${leads.length} leads. URL: ${mlApiUrl}`,
          )
          console.log('ML API payload:', JSON.stringify(payload, null, 2))

          let response: Response
          try {
            response = await fetch(mlApiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            })
          } catch (fetchError) {
            const reason = fetchError instanceof Error ? fetchError.message : String(fetchError)
            throw new Error(`ML API fetch failed for ${mlApiUrl}: ${reason}`)
          }

          if (!response.ok) {
            const text = await response.text()
            throw new Error(`ML API returned ${response.status}: ${text}`)
          }

          const responseData = await response.text()
          console.log(`ML API success for ${campaign.id}:`, responseData)
        } else {
          console.log(`No ML API URL for admin (set admins.ml_api_url, ML_API_URL_${adminRouting?.datasourceBinding ?? 'BINDING'}, or ML_API_URL). Dry-run for campaign ${campaign.id}.`, payload)
        }
        summary.triggeredCampaignIds.push(campaign.id)

        // ML API call succeeded, leads are now processing.
        // We will leave campaign status as 'live' and leads as 'pending' (or update them to processing if preferred).
        // For now, updating leads callStatus to 'processing' helps track them.
        
        // SQLite has a limit on variables in a single query, so we do this in chunks if needed
        const leadIds = leads.map(l => l.id)
        const chunkSize = 100
        for (let i = 0; i < leadIds.length; i += chunkSize) {
          const chunk = leadIds.slice(i, i + chunkSize)
          await setLeadsStatus(env, chunk, 'processing')
        }

      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.error(`Failed to process campaign ${campaign.id}:`, err)
        // Mark campaign as failed so we can see the issue in the dashboard
        const pendingLeads = await getPendingLeads(env, campaign.id)
        await setLeadsStatus(env, pendingLeads.map((lead) => lead.id), 'failed')
        await setCampaignStatus(env, campaign.id, 'failed')
        summary.failed.push({ campaignId: campaign.id, reason })
      }
    }
    return summary
  } catch (error) {
    console.error('Scheduler encountered a critical error:', error)
    throw error
  }
}
