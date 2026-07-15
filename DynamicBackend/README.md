```txt
npm install
npm run dev
```

```txt
npm run deploy
```

- D1: run `npm run db:migrate:local` / `npm run db:migrate:remote`. Tenant dashboard SQL: `0019`/`0020` (IIFL/Fujitsu), `0022` (Accelbiz logs), `0024` (Towner Postgres), `0025` (drop BigQuery admin columns). Towner uses Hyperdrive binding `TOWNER_DB` in `wrangler.jsonc` (not `wrangler secret put TOWNER_DB`).

Production notes:

- Campaign lead dumps run inside the Cloudflare Worker and should use a write-capable connection such as `VCONNECT_WRITE_DB`, `POSTGRES_WRITE_URL`, or a write-enabled `VCONNECT_DB` binding.
- Keep local connection strings in `.dev.vars` such as `DATABASE_URL` or `VCONNECT_DB_CONNECTION_STRING`; do not commit them in `wrangler.jsonc`.
- The Hyperdrive target must point at write-capable Postgres credentials, because imports upsert into `vconnect_data.dump_lead_info`.
- The scheduler POSTs only `{ bot_id, batch_id, expected_count }` to the resolved ML URL.
  - **Resolution Order**:
    1. D1 `admins.ml_api_url` (direct DB configuration).
    2. Env variable `ML_API_${SLUG}` or `ML_API_URL_${SLUG}` (e.g. `ml_api_iifl` for admin slug `iiflsamasta`, `ml_api_newcompany` for admin slug `newcompany`). Matches are case-insensitive.
    3. Env variable `ML_API_URL_${datasource_binding}` (e.g. `ML_API_URL_ACCELBIZ_DB`).
    4. `ML_API_URL` (global default).
  - **Adding a New Account**: When creating a new company/admin account, configure the `ml_api_url` column in the `admins` table directly, or declare a corresponding environment variable `ml_api_{company_slug}` / `ML_API_{COMPANY_SLUG}` (in `.dev.vars` for local development, and via Wrangler/Cloudflare Dashboard for production).
  - Migrations: `0023` (Accelbiz → `https://accelbiz.nestalab.com/call_customers`), `0021` (IIFL → `https://vconnect.nestalab.com/call_customers`). Each admin writes only to **their** Postgres; the dialer must read **that** tenant’s DB for `batch_id`.
- Debug: `GET /api/campaigns/:campaignId/ml-preview` returns the resolved URL plus the exact three-field payload for pending leads.
- Scheduler: eligible campaigns are `pending` with campaign `scheduled_at <= now` or null; each run then requires `effectiveScheduledAt <= now` (campaign or earliest lead time) before calling ML. Very stale `pending` campaigns are auto-failed after **`SCHEDULER_MAX_PAST_DUE_HOURS`** (default **24** when unset). Set **`0`** to disable that guard if long delays between schedule and dial are normal.
- Optional `ACCELBIZ_DUMP_LEAD_WEBHOOK_URL` in `.dev.vars`: sets `webhook_url` on Accelbiz `dump_lead_info` inserts (same column as the DE test script).
- AI agent creation now calls the prompt-generator service during create/update. Set `PROMPT_GENERATOR_URL` in `.dev.vars` for local development.
- Analytics chatbot uses an OpenAI-compatible chat-completions model endpoint. Set `LLM_BASE_URL` and `LLM_MODEL` in `.dev.vars` for local development, or `LLM_API_URL` if you want to point directly at `/v1/chat/completions`. Add `LLM_API_KEY` only when the model server requires bearer auth.
- **Towner Taxi** dashboards use Postgres schema `"Towner_data"` via `TOWNER_DB` / `TOWNER_DB_URL` (readonly `towner_taxi_ro`). Migration `0024` sets dashboard SQL; `0025` removes legacy BigQuery columns from `admins`. Campaign lead dumps for Towner are not configured until a `postgres_lead_table` is defined.

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
