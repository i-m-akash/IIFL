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
    let sql: ReturnType<typeof postgres> | null = null
    let resolved: any = null
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
        resolved = resolvePostgresReadUrl(c.env, adminRow.datasourceBinding)
        if (!resolved) {
            return c.json(
                {
                    success: false,
                    error: `No Postgres connection configured for datasource binding '${adminRow.datasourceBinding ?? 'unset'}'. Configure a Hyperdrive binding or DATABASE_URL.`,
                },
                500,
            )
        }

        // Initialize postgres connection
        sql = postgres(resolved.url, {
            max: resolved.viaHyperdrive ? 5 : 1,
            idle_timeout: resolved.viaHyperdrive ? 20 : 5,
            connect_timeout: 10,
            prepare: false,
            fetch_types: false,
            onnotice: () => { },
        })

        // ── Detect Schema and Table(s) dynamically from PostgreSQL ───────────────
        let schema = adminRow.postgresSchema?.trim() || 'mobicule_data'
        let detectedTables: string[] = []

        try {
            const tableMatches = (await sql.unsafe(`
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_name IN ('fact_answered_calls', 'fact_answered_customer', 'fact_answered_employee')
                  AND table_schema NOT IN ('pg_catalog', 'information_schema')
            `)) as Record<string, unknown>[]

            if (tableMatches.length > 0) {
                // Determine the correct schema from the database
                let matchedSchema = tableMatches[0].table_schema as string
                const configuredSchemaMatch = tableMatches.find(t => String(t.table_schema).toLowerCase() === schema.toLowerCase())
                if (configuredSchemaMatch) {
                    matchedSchema = configuredSchemaMatch.table_schema as string
                }

                schema = matchedSchema
                detectedTables = tableMatches
                    .filter(t => String(t.table_schema).toLowerCase() === matchedSchema.toLowerCase())
                    .map(t => t.table_name as string)
            }
        } catch (detectErr) {
            console.warn('Postgres schema detection failed, falling back:', detectErr)
        }

        // If the detected schema is different from the saved SQLite config, fix the configuration in SQLite
        if (schema && schema !== adminRow.postgresSchema) {
            await db
                .update(admins)
                .set({ postgresSchema: schema })
                .where(eq(admins.id, user.adminId))
                .catch((err) => console.error('Failed to update SQLite config:', err))
        }

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

        // ── Build billing SQL using detected schema & table(s) ──────────────────

        let billingTable: string
        if (detectedTables.includes('fact_answered_customer') || detectedTables.includes('fact_answered_employee')) {
            const selectParts: string[] = []
            if (detectedTables.includes('fact_answered_customer')) {
                selectParts.push(`SELECT client_name, agent_id, date, call_duration::text AS call_duration, call_uuid FROM ${schema}.fact_answered_customer`)
            }
            if (detectedTables.includes('fact_answered_employee')) {
                selectParts.push(`SELECT client_name, agent_id, date, call_duration::text AS call_duration, call_uuid FROM ${schema}.fact_answered_employee`)
            }
            billingTable = `(${selectParts.join(' UNION ALL ')}) AS unified_billing`
        } else {
            billingTable = `${schema}.fact_answered_calls`
        }

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
        ${optionalFilters.join('\n        ')}
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
                        error: `Billing table not found in schema "${schema}". Set the correct Postgres schema in your admin settings.`,
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
    } catch (err) {
        console.error('Billing report error:', err)
        const message = err instanceof Error ? err.message : 'Query failed'
        return c.json({ success: false, error: message }, 500)
    } finally {
        if (sql && resolved && !resolved.viaHyperdrive) {
            await sql.end({ timeout: 5 }).catch((e) => console.warn('Postgres end error:', e))
        }
    }
})
