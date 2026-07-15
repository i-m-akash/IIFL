import type { AuthPayload } from './lib/jwt'
import type { createDb } from './db'

type Db = ReturnType<typeof createDb>

export type AppEnv = {
  Bindings: Record<string, unknown> & {
    DB: D1Database
    JWT_SECRET?: string
    /** Local/demo fallback when Hyperdrive binding is not available. */
    DATABASE_URL?: string
    VCONNECT_DB?: Hyperdrive
    VCONNECT_DB_WRITE?: Hyperdrive
    VCONNECT_DB_URL?: string
    VCONNECT_DB_WRITE_URL?: string
    FUJITSU_DB?: Hyperdrive
    FUJITSU_DB_WRITE?: Hyperdrive
    FUJITSU_DB_URL?: string
    FUJITSU_DB_WRITE_URL?: string
    ACCELBIZ_DB?: Hyperdrive
    ACCELBIZ_DB_WRITE?: Hyperdrive
    ACCELBIZ_DB_URL?: string
    ACCELBIZ_DB_WRITE_URL?: string
    TOWNER_DB?: Hyperdrive
    TOWNER_DB_URL?: string
    POSTGRES_WRITE_URL?: string
    VCONNECT_WRITE_DB?: Hyperdrive
    ML_API_URL?: string
    /**
     * Optional per-admin override when `admins.ml_api_url` is null: `ML_API_URL_${datasourceBinding}`.
     * Example: binding `ACCELBIZ_DB` → set `ML_API_URL_ACCELBIZ_DB`.
     */
    ML_API_URL_ACCELBIZ_DB?: string
    ML_API_URL_VCONNECT_DB?: string
    /** Multi-tenant ML API overrides resolved by admin slug. */
    ml_api_iifl?: string
    ml_api_fujitsu?: string
    ml_api_accelbiz?: string
    ml_api_towner?: string
    POSTGRES_DUMP_OPTIONAL?: string
    PROMPT_GENERATOR_URL?: string
    LLM_BASE_URL?: string
    LLM_API_URL?: string
    LLM_MODEL?: string
    LLM_API_KEY?: string
    /** Optional `webhook_url` for Accelbiz `dump_lead_info` rows (same shape as DE test insert). */
    ACCELBIZ_DUMP_LEAD_WEBHOOK_URL?: string
    HYPERDRIVE?: Hyperdrive
    /**
     * If set to a positive number (hours), campaigns whose effective schedule is older than
     * `now - hours` are not dialed and are marked failed (avoids stale pending campaigns firing ML).
     * Set to `0` to disable. Default when unset: 24 hours.
     */
    SCHEDULER_MAX_PAST_DUE_HOURS?: string
  }
  Variables: {
    user?: AuthPayload
    db?: Db
  }
}
