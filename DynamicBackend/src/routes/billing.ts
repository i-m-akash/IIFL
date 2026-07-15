import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'

import { admins } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { resolvePostgresReadUrl } from '../services/postgresConnection'
import type { AppEnv } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly'

type BillingRow = {
    client_name: string
    agent_id: string
    call_date: string
    total_calls: number
    total_duration_seconds: number
    total_bill_duration_seconds: number
    total_bill_minutes: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayIST(): string {
    // IST = UTC+5:30
    const now = new Date()
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    return ist.toISOString().slice(0, 10)
}

function getFirstOfMonthIST(): string {
    return getTodayIST().slice(0, 7) + '-01'
}

function isValidDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value))
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const billingRoutes = new Hono<AppEnv>().use('*', authMiddleware)

/**
 * GET /api/billing-report
 *
 * Query params:
 *   period        - "daily" | "weekly" | "monthly"  (default: "daily")
 *   date_from     - YYYY-MM-DD  (default: first day of current month IST)
 *   date_to       - YYYY-MM-DD  (default: today IST)
 *   exclude_under - 0 | 5 | 10 | 15  (exclude calls shorter than N seconds; 0 = include all)
 *   client        - optional client_name filter, case-insensitive partial match
 *
 * Admin-only endpoint. Runs against the admin's configured Postgres datasource.
 *
 * Billing logic: each call duration is rounded UP to the nearest 60s.
 * Only counts answered calls where webhook_status = 'sent'.
 */
billingRoutes.get('/report', async (c) => {
    try {
        const user = c.get('user')!

        // Admin-only
        if (user.role !== 'admin') {
            return c.json({ success: false, error: 'Admin access required' }, 403)
        }

        const db = c.get('db')!

        // Load admin row (for datasourceBinding)
        const adminRow = (await db.select().from(admins).where(eq(admins.id, user.adminId)).limit(1))[0]
        if (!adminRow) {
            return c.json({ success: false, error: 'Admin not found' }, 404)
        }

        // Resolve Postgres connection
        const resolved = resolvePostgresReadUrl(c.env, adminRow.datasourceBinding)
        if (!resolved) {
            return c.json(
                {
                    success: false,
                    error: `No Postgres connection configured for datasource binding '${adminRow.datasourceBinding ?? 'unset'}'. Configure a Hyperdrive binding or DATABASE_URL.`,
                },
                500,
            )
        }

        const sql = postgres(resolved.url, {
            max: resolved.viaHyperdrive ? 5 : 1,
            idle_timeout: resolved.viaHyperdrive ? 20 : 5,
            connect_timeout: 10,
            prepare: false,
            fetch_types: false,
            onnotice: () => { },
        })

        try {
            // ── Parse & validate query params ────────────────────────────────────────

            const rawPeriod = c.req.query('period') ?? 'daily'
            const period: Period = ['daily', 'weekly', 'monthly'].includes(rawPeriod)
                ? (rawPeriod as Period)
                : 'daily'

            const rawExclude = parseInt(c.req.query('exclude_under') ?? '0', 10)
            const excludeUnder = [0, 5, 10, 15].includes(rawExclude) ? rawExclude : 0

            const rawDateFrom = c.req.query('date_from') ?? ''
            const rawDateTo = c.req.query('date_to') ?? ''
            const dateFrom = isValidDate(rawDateFrom) ? rawDateFrom : getFirstOfMonthIST()
            const dateTo = isValidDate(rawDateTo) ? rawDateTo : getTodayIST()
            const clientFilter = (c.req.query('client') ?? '').trim()
            const agentIdFilter = (c.req.query('agent_id') ?? '').trim()

            // ── Dynamically Detect Schema and Tables ─────────────────────────────────

            let detectedSchema = adminRow.postgresSchema?.trim() || 'mobicule_data'
            let detectedTables: string[] = ['fact_answered_calls']

            try {
                // Find any matching tables in information_schema
                const matchingTables = (await sql.unsafe(`
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_name IN ('fact_answered_calls', 'fact_answered_customer', 'fact_answered_employee')
                      AND table_schema NOT IN ('pg_catalog', 'information_schema')
                `)) as Record<string, unknown>[]

                if (matchingTables.length > 0) {
                    const firstMatchSchema = String(matchingTables[0].table_schema ?? '').trim()
                    if (firstMatchSchema) {
                        detectedSchema = firstMatchSchema
                    }

                    // Find all tables starting with 'fact_answered_' in that detected schema
                    const schemaTables = (await sql.unsafe(`
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = $1 AND table_name LIKE 'fact_answered_%'
                    `, [detectedSchema])) as Record<string, unknown>[]

                    if (schemaTables.length > 0) {
                        detectedTables = schemaTables.map(t => String(t.table_name ?? ''))
                    }
                }
            } catch (detectErr) {
                console.warn('Failed to detect schema/tables from Postgres:', detectErr)
            }

            // Sync detected schema to SQLite if needed
            if (detectedSchema !== adminRow.postgresSchema) {
                try {
                    await db.update(admins)
                        .set({ postgresSchema: detectedSchema })
                        .where(eq(admins.id, user.adminId))
                } catch (updateErr) {
                    console.error('Failed to update admin postgresSchema in local DB:', updateErr)
                }
            }

            // Construct billing table or subquery
            let billingTable: string
            if (detectedTables.length > 1) {
                const subqueries = detectedTables.map(t => `SELECT client_name, agent_id, date::text as date, call_uuid, call_duration::text as call_duration FROM ${detectedSchema}.${t}`)
                billingTable = `(${subqueries.join(' UNION ALL ')}) AS combined_answered_calls`
            } else if (detectedTables.length === 1) {
                billingTable = `${detectedSchema}.${detectedTables[0]}`
            } else {
                billingTable = `${detectedSchema}.fact_answered_calls`
            }

            // ── Build billing SQL using detected schema & tables ──────────────────

            let dateExpr: string
            if (period === 'monthly') {
                dateExpr = "TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM')"
            } else if (period === 'weekly') {
                dateExpr = "TO_CHAR(DATE_TRUNC('week', TO_DATE(date, 'YYYY-MM-DD')), 'YYYY-MM-DD')"
            } else {
                dateExpr = 'date'
            }

            // Duration filter (must be numeric, optionally >= excludeUnder seconds)
            const durFilter =
                excludeUnder > 0
                    ? `AND call_duration ~ '^[0-9]+(\\.[0-9]+)?$' AND CAST(call_duration AS FLOAT) >= ${excludeUnder}`
                    : `AND call_duration ~ '^[0-9]+(\\.[0-9]+)?$'`

            const queryParams: any[] = [dateFrom, dateTo]
            const optionalFilters: string[] = []
            if (clientFilter) {
                queryParams.push(`%${clientFilter}%`)
                optionalFilters.push(`AND client_name ILIKE $${queryParams.length}`)
            }
            if (agentIdFilter) {
                queryParams.push(`%${agentIdFilter}%`)
                optionalFilters.push(`AND agent_id ILIKE $${queryParams.length}`)
            }

            const querySql = `
          SELECT
            client_name,
            COALESCE(agent_id, '') AS agent_id,
            ${dateExpr} AS call_date,
            COUNT(DISTINCT call_uuid)::bigint AS total_calls,
            ROUND(SUM(CAST(call_duration AS FLOAT))::numeric, 0)::bigint AS total_duration_seconds,
            SUM(CEIL(CAST(call_duration AS FLOAT) / 60.0) * 60)::bigint AS total_bill_duration_seconds,
            SUM(CEIL(CAST(call_duration AS FLOAT) / 60.0))::bigint AS total_bill_minutes
          FROM ${billingTable}
          WHERE date BETWEEN $1 AND $2
            -- AND LOWER(webhook_status) = 'sent'
            AND call_duration IS NOT NULL
            ${durFilter}
            ${optionalFilters.join('\n            ')}
          GROUP BY client_name, COALESCE(agent_id, ''), ${dateExpr}
          ORDER BY client_name, agent_id, call_date
        `

            let rows: BillingRow[]
            try {
                const rawRows = (await sql.unsafe(querySql, queryParams)) as Record<string, unknown>[]
                rows = rawRows.map((r) => ({
                    client_name: String(r.client_name ?? ''),
                    agent_id: String(r.agent_id ?? ''),
                    call_date: String(r.call_date ?? ''),
                    total_calls: Number(r.total_calls ?? 0),
                    total_duration_seconds: Number(r.total_duration_seconds ?? 0),
                    total_bill_duration_seconds: Number(r.total_bill_duration_seconds ?? 0),
                    total_bill_minutes: Number(r.total_bill_minutes ?? 0),
                }))
            } catch (queryErr) {
                const msg = queryErr instanceof Error ? queryErr.message : String(queryErr)
                // Surface a clean message when the billing table is not configured for this admin
                if (/relation .* does not exist/i.test(msg)) {
                    return c.json(
                        {
                            success: false,
                            error: `Billing table not found: ${billingTable}. Set the correct Postgres schema in your admin settings (current: "${detectedSchema}").`,
                        },
                        422,
                    )
                }
                throw queryErr
            }

            // ── Grand totals ──────────────────────────────────────────────────────────

            const totals = rows.reduce(
                (acc, r) => ({
                    total_calls: acc.total_calls + r.total_calls,
                    total_duration_seconds: acc.total_duration_seconds + r.total_duration_seconds,
                    total_bill_duration_seconds: acc.total_bill_duration_seconds + r.total_bill_duration_seconds,
                    total_bill_minutes: acc.total_bill_minutes + r.total_bill_minutes,
                }),
                {
                    total_calls: 0,
                    total_duration_seconds: 0,
                    total_bill_duration_seconds: 0,
                    total_bill_minutes: 0,
                },
            )

            return c.json({
                success: true,
                date_from: dateFrom,
                date_to: dateTo,
                period,
                exclude_under: excludeUnder,
                client: clientFilter,
                agent_id: agentIdFilter,
                rows,
                totals,
            })
        } finally {
            // Don't close Hyperdrive-backed connections — they are pooled
            if (!resolved.viaHyperdrive) {
                await sql.end({ timeout: 5 }).catch((e) => console.warn('Postgres end error:', e))
            }
        }
    } catch (err) {
        console.error('Billing report error:', err)
        const message = err instanceof Error ? err.message : 'Query failed'
        return c.json({ success: false, error: message }, 500)
    }
})
