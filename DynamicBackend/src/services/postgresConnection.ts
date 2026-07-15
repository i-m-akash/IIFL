import type { AppEnv } from '../types'

function readHyperdriveConnectionString(binding: unknown) {
  if (!binding || typeof binding !== 'object') return null
  const candidate = binding as { connectionString?: unknown }
  return typeof candidate.connectionString === 'string' && candidate.connectionString.trim().length > 0
    ? candidate.connectionString.trim()
    : null
}

function readEnvConnectionString(env: AppEnv['Bindings'], key: string) {
  const value = env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function maskPostgresUrl(url: string) {
  try {
    const parsed = new URL(url)
    const user = parsed.username ? '***' : ''
    return `${parsed.protocol}//${user ? `${user}@` : ''}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`
  } catch {
    return '(invalid-url)'
  }
}

/**
 * Read-only dashboards: Hyperdrive binding first, then direct URL override.
 */
export function resolvePostgresReadUrl(env: AppEnv['Bindings'], datasourceBinding?: string | null) {
  if (datasourceBinding) {
    const hyperdrive = readHyperdriveConnectionString(env[datasourceBinding])
    if (hyperdrive) return { url: hyperdrive, viaHyperdrive: true }

    const bindingUrl = readEnvConnectionString(env, `${datasourceBinding}_URL`)
    if (bindingUrl) return { url: bindingUrl, viaHyperdrive: false }
  }

  const databaseUrl = readEnvConnectionString(env, 'DATABASE_URL')
  if (databaseUrl) return { url: databaseUrl, viaHyperdrive: false }

  return null
}

/**
 * Campaign lead dumps need INSERT.
 * Priority:
 *   1. Dedicated write Hyperdrive (e.g. ACCELBIZ_DB_WRITE) — production write pool
 *   2. Read Hyperdrive (e.g. ACCELBIZ_DB) — routes via Cloudflare proxy, can INSERT
 *   3. Write-specific direct URL (e.g. ACCELBIZ_DB_WRITE_URL) — explicit override
 *   4. Direct URL (e.g. ACCELBIZ_DB_URL) — last resort; blocked by AWS firewall in most cases
 *
 * Both IIFL and Accelbiz DB servers block direct connections from non-Cloudflare IPs.
 * Hyperdrive routes through Cloudflare's whitelisted IPs, so it always works.
 */
export function resolvePostgresWriteUrl(env: AppEnv['Bindings'], datasourceBinding?: string | null) {
  if (datasourceBinding) {
    // 1. Dedicated write Hyperdrive (e.g. ACCELBIZ_DB_WRITE)
    const writeBindingName = `${datasourceBinding}_WRITE`
    const writeHyperdrive = readHyperdriveConnectionString(env[writeBindingName])
    if (writeHyperdrive) return { url: writeHyperdrive, viaHyperdrive: true }

    // 2. Read Hyperdrive (e.g. ACCELBIZ_DB) — Cloudflare-routed, works even when direct is blocked
    const readHyperdrive = readHyperdriveConnectionString(env[datasourceBinding])
    if (readHyperdrive) return { url: readHyperdrive, viaHyperdrive: true }

    // 3. Explicit write-only direct URL (e.g. ACCELBIZ_DB_WRITE_URL)
    const writeUrl = readEnvConnectionString(env, `${datasourceBinding}_WRITE_URL`)
    if (writeUrl) return { url: writeUrl, viaHyperdrive: false }

    // 4. Regular direct URL — last resort, typically blocked by AWS firewall
    const directUrl = readEnvConnectionString(env, `${datasourceBinding}_URL`)
    if (directUrl) return { url: directUrl, viaHyperdrive: false }
  }

  const postgresWrite = readEnvConnectionString(env, 'POSTGRES_WRITE_URL')
  if (postgresWrite) return { url: postgresWrite, viaHyperdrive: false }

  const databaseUrl = readEnvConnectionString(env, 'DATABASE_URL')
  if (databaseUrl) return { url: databaseUrl, viaHyperdrive: false }

  return null
}

export function formatPostgresWriteSetupHint(datasourceBinding?: string | null) {
  const binding = datasourceBinding ?? 'DATASOURCE'
  return (
    `Configure a write-capable Postgres connection for this admin: ` +
    `add a ${binding}_WRITE Hyperdrive binding in wrangler.jsonc (recommended for production), ` +
    `or set ${binding}_WRITE_URL in .dev.vars for a direct write-capable connection.`
  )
}

export function isPostgresPermissionDenied(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /permission denied/i.test(message)
}
