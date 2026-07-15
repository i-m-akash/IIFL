-- Accelbiz call logs: unanswered + answered (UNION ALL), AgentID column, shared pagination.
PRAGMA foreign_keys = ON;

UPDATE bots
SET dashboard_logs_query = 'SELECT
  TO_CHAR(f.date::DATE, ''DD Mon YYYY'') AS "Date",
  TO_CHAR(f.time::TIME, ''HH24:MI:SS'') AS "Time",
  f.reference_id AS "ReferenceID",
  f.batch_id AS "BatchID",
  f.agent_id AS "AgentID",
  f.client_name AS "ClientName",
  COALESCE(f.customer_name, ''N/A'') AS "CustomerName",
  f.customer_number AS "CustomerNumber",
  TO_CHAR(h.start_time AT TIME ZONE ''Asia/Kolkata'', ''HH24:MI:SS'') AS "StartTime",
  TO_CHAR(h.end_time AT TIME ZONE ''Asia/Kolkata'', ''HH24:MI:SS'') AS "EndTime",
  h.talk_time_duration AS "TalkTime",
  f.call_outcome AS "CallStatus",
  f.hangup_source AS "HangupSource",
  f.hangup_cause_name AS "HangupReason"
FROM accelbiz_data.fact_unanswered_calls f
JOIN accelbiz_data.hangup_data h ON f.call_uuid = h.call_uuid
WHERE f.agent_id = $1
UNION ALL
SELECT
  TO_CHAR(f.date::DATE, ''DD Mon YYYY'') AS "Date",
  TO_CHAR(f.time::TIME, ''HH24:MI:SS'') AS "Time",
  f.reference_id AS "ReferenceID",
  f.batch_id AS "BatchID",
  f.agent_id AS "AgentID",
  f.client_name AS "ClientName",
  COALESCE(f.customer_name, ''N/A'') AS "CustomerName",
  f.customer_number AS "CustomerNumber",
  TO_CHAR(h.start_time AT TIME ZONE ''Asia/Kolkata'', ''HH24:MI:SS'') AS "StartTime",
  TO_CHAR(h.end_time AT TIME ZONE ''Asia/Kolkata'', ''HH24:MI:SS'') AS "EndTime",
  h.talk_time_duration AS "TalkTime",
  f.call_outcome AS "CallStatus",
  f.hangup_source AS "HangupSource",
  f.hangup_cause_name AS "HangupReason"
FROM accelbiz_data.fact_answered_calls f
JOIN accelbiz_data.hangup_data h ON f.call_uuid = h.call_uuid
WHERE f.agent_id = $1
ORDER BY "Date" DESC, "Time" DESC
LIMIT $2 OFFSET $3'
WHERE admin_id = 't0000001-0000-4000-8000-000000000001';
