-- Towner Taxi: Postgres dashboards (replaces legacy BigQuery seeds in 0006 / 0012).
-- Schema "Towner_data" per data-engineering integration report.
PRAGMA foreign_keys = ON;

UPDATE admins
SET
  analytics_source = 'hyperdrive_postgres',
  datasource_binding = 'TOWNER_DB',
  postgres_schema = 'Towner_data'
WHERE slug = 'Towner_Taxi' OR id = 'a0000002-0000-4000-8000-000000000001';

UPDATE bots
SET
  client_id = COALESCE(client_id, 'c0000002-0000-4000-8000-000000000001'),
  dashboard_logs_query = 'SELECT
  COALESCE(NULLIF(f.date::text, ''''), ''N/A'') AS "Date",
  COALESCE(NULLIF(TO_CHAR(f.time, ''HH24:MI:SS''), ''''), ''N/A'') AS "Time",
  COALESCE(NULLIF(f.customer_name, ''''), ''N/A'') AS "CustomerName",
  COALESCE(NULLIF(f.customer_number, ''''), ''N/A'') AS "CustomerNumber",
  COALESCE(NULLIF(f.call_duration::text, ''''), ''N/A'') AS "Duration",
  COALESCE(NULLIF(TO_CHAR(h.start_time, ''HH24:MI:SS''), ''''), ''N/A'') AS "StartTime",
  COALESCE(NULLIF(TO_CHAR(h.end_time, ''HH24:MI:SS''), ''''), ''N/A'') AS "EndTime",
  COALESCE(NULLIF(h.hangup_cause, ''''), ''N/A'') AS "HangupCause",
  COALESCE(NULLIF(f.hangup_cause_name, ''''), ''N/A'') AS "HangupCauseName"
FROM "Towner_data".fact_answered_calls f
LEFT JOIN "Towner_data".hangup_data h ON f.call_uuid = h.call_uuid
WHERE f.agent_id = $1
ORDER BY f.date DESC, f.time DESC
LIMIT $2 OFFSET $3',
  dashboard_analytics_query = 'SELECT
  COALESCE(NULLIF(date::text, ''''), ''N/A'') AS "Date",
  COALESCE(NULLIF(TO_CHAR(time, ''HH24:MI:SS''), ''''), ''N/A'') AS "Time",
  COALESCE(NULLIF(customer_name, ''''), ''N/A'') AS "CustomerName",
  COALESCE(NULLIF(customer_number, ''''), ''N/A'') AS "CustomerNumber",
  COALESCE(NULLIF(call_duration::text, ''''), ''N/A'') AS "CallDuration",
  COALESCE(NULLIF(call_purpose, ''''), ''N/A'') AS "CallPurpose",
  COALESCE(NULLIF(customer_satisfaction, ''''), ''N/A'') AS "CustomerSatisfaction",
  COALESCE(NULLIF(sentiment, ''''), ''N/A'') AS "Sentiment",
  CASE
    WHEN ondc_interest IS TRUE THEN ''True''
    WHEN ondc_interest IS FALSE THEN ''False''
    ELSE ''N/A''
  END AS "OndcInterest",
  CASE
    WHEN ev_roadmap_interest IS TRUE THEN ''True''
    WHEN ev_roadmap_interest IS FALSE THEN ''False''
    ELSE ''N/A''
  END AS "EvRoadmapInterest",
  COALESCE(NULLIF(product_sentiment, ''''), ''N/A'') AS "ProductSentiment",
  COALESCE(NULLIF(summary, ''''), ''N/A'') AS "Summary",
  COALESCE(NULLIF(transcript, ''''), ''N/A'') AS "Transcript",
  COALESCE(NULLIF(recording, ''''), ''N/A'') AS "Recording"
FROM "Towner_data".fact_answered_calls
WHERE agent_id = $1
ORDER BY date DESC, time DESC
LIMIT $2 OFFSET $3'
WHERE admin_id = 'a0000002-0000-4000-8000-000000000001'
  AND external_ref = 'Towner_Taxi';
