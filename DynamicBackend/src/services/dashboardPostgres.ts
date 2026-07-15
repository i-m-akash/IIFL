import postgres from 'postgres'
import type { Sql } from 'postgres'
import type { AppEnv } from '../types'
import { resolvePostgresReadUrl } from './postgresConnection'

function createSqlClient(connectionString: string, viaHyperdrive: boolean): Sql {
  return postgres(connectionString, {
    max: viaHyperdrive ? 5 : 1,
    idle_timeout: viaHyperdrive ? 20 : 5,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
  })
}

async function closeSqlClient(sql: Sql, viaHyperdrive: boolean) {
  if (viaHyperdrive) return
  try {
    await sql.end({ timeout: 5 })
  } catch (error) {
    console.warn('Postgres end error:', error)
  }
}

function normalizeCell(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

function serializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCell(value)]))
}

type DashboardPageResult = {
  pages: Record<number, Record<string, string>[]>
  totalPages: number
  totalCount: number
}

/** Injects `AND <alias>.batch_id = $n` for legacy tenant dashboard SQL (agent filter is always `$1`). */
export function applyBatchIdToDashboardSql(querySql: string, batchParamIndex: number): string {
  const batchParam = `$${batchParamIndex}`
  return querySql
    .replaceAll('WHERE f.agent_id = $1', `WHERE f.agent_id = $1 AND f.batch_id = ${batchParam}`)
    .replaceAll('WHERE l.agent_id = $1', `WHERE l.agent_id = $1 AND l.batch_id = ${batchParam}`)
    .replaceAll('WHERE c.agent_id = $1', `WHERE c.agent_id = $1 AND c.batch_id = ${batchParam}`)
    .replaceAll('WHERE agent_id = $1', `WHERE agent_id = $1 AND batch_id = ${batchParam}`)
}

function usesDeBatchParam(querySql: string) {
  return /\bbatch_id\s*=\s*\$2\b/i.test(querySql) && /\bLIMIT\s+\$3\b/i.test(querySql)
}

function stripDeBatchFilter(querySql: string) {
  const withoutBatch = querySql.replace(/\s+AND\s+[a-z]\.batch_id\s*=\s*\$2\b/gi, '')
  return withoutBatch.replace(/\$4\b/g, '$3').replace(/\$3\b/g, '$2')
}

type DashboardExec = { sql: string; params: (string | number)[] }

function buildDashboardExec(
  querySql: string,
  agentExternalRef: string,
  pageSize: number,
  offset: number,
  batchId?: string,
): DashboardExec {
  const trimmedBatch = batchId?.trim()

  if (usesDeBatchParam(querySql)) {
    if (trimmedBatch) {
      return { sql: querySql, params: [agentExternalRef, trimmedBatch, pageSize, offset] }
    }
    return { sql: stripDeBatchFilter(querySql), params: [agentExternalRef, pageSize, offset] }
  }

  if (trimmedBatch) {
    return {
      sql: applyBatchIdToDashboardSql(querySql, 4),
      params: [agentExternalRef, pageSize, offset, trimmedBatch],
    }
  }

  if (/\bLIMIT\s+\$2\b/i.test(querySql) || /\bOFFSET\s+\$3\b/i.test(querySql)) {
    return { sql: querySql, params: [agentExternalRef, pageSize, offset] }
  }
  if (/\$3\b/.test(querySql)) {
    return { sql: querySql, params: [agentExternalRef, pageSize, offset] }
  }
  return { sql: querySql, params: [pageSize, offset] }
}

export async function getCallDashboardPostgres(
  env: AppEnv['Bindings'],
  datasourceBinding: string | null | undefined,
  querySql: string,
  agentExternalRef: string,
  page: number,
  pageSize: number,
  options?: { batchId?: string; startDate?: string; endDate?: string; search?: string },
): Promise<DashboardPageResult> {
  const resolved = resolvePostgresReadUrl(env, datasourceBinding)
  if (!resolved) {
    throw new Error(`No Postgres connection configured for datasource binding '${datasourceBinding ?? 'unset'}'`)
  }

  const sql = createSqlClient(resolved.url, resolved.viaHyperdrive)

  try {
    const offset = (page - 1) * pageSize
    const { sql: sqlToRun, params } = buildDashboardExec(
      querySql,
      agentExternalRef,
      pageSize,
      offset,
      options?.batchId,
    )
    const rows = (await sql.unsafe(sqlToRun, params)) as Record<string, unknown>[]

    const totalPages = rows.length === pageSize ? page + 1 : page
    const totalCount = (page - 1) * pageSize + rows.length

    return {
      pages: { [page]: rows.map(serializeRow) },
      totalPages,
      totalCount,
    }
  } catch (error) {
    console.error('Dashboard Postgres Error:', error)
    throw error
  } finally {
    await closeSqlClient(sql, resolved.viaHyperdrive)
  }
}

export async function getAllCallDashboardPostgres(
  env: AppEnv['Bindings'],
  datasourceBinding: string | null | undefined,
  querySql: string,
  agentExternalRef: string,
  batchId?: string,
): Promise<Record<string, string>[]> {
  const resolved = resolvePostgresReadUrl(env, datasourceBinding)
  if (!resolved) {
    throw new Error(`No Postgres connection configured for datasource binding '${datasourceBinding ?? 'unset'}'`)
  }

  const sql = createSqlClient(resolved.url, resolved.viaHyperdrive)

  try {
    const pageSize = 1000
    const allRows: Record<string, string>[] = []
    let page = 1

    while (true) {
      const offset = (page - 1) * pageSize
      const { sql: sqlToRun, params } = buildDashboardExec(
        querySql,
        agentExternalRef,
        pageSize,
        offset,
        batchId,
      )
      const rows = (await sql.unsafe(sqlToRun, params)) as Record<string, unknown>[]
      allRows.push(...rows.map(serializeRow))
      if (rows.length < pageSize) break
      page += 1
    }

    return allRows
  } catch (error) {
    console.error('Dashboard Postgres Error:', error)
    throw error
  } finally {
    await closeSqlClient(sql, resolved.viaHyperdrive)
  }
}
