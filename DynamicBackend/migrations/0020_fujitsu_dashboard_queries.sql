-- Ported from seed_fujitsu.sql: dashboard SQL for General HVAC Fujitsu agent (external_ref = Fujitsu)
PRAGMA foreign_keys = ON;

UPDATE bots
SET
  dashboard_analytics_query = 'SELECT
    to_char(h.created_at, ''DD Mon YYYY'') AS "Date",
    to_char(h.created_at, ''HH24:MI:SS'') AS "Time",
    c.agent_id AS "AgentID",
    h.mobile_number AS "CustomerNumber",
    COALESCE(an.customer_name, ''N/A'') AS "CustomerName",
    CASE
      WHEN h.hangup_time IS NOT NULL THEN to_char(h.hangup_time - h.created_at, ''MI"m "SS"s"'')
      ELSE ''0m 0s''
    END AS "Duration",
    h.status AS "CallStatus",
    an.sentiment AS "Sentiment",
    an.service_type AS "ServiceType",
    an.ac_type AS "ACType",
    an.issue_mentioned AS "Issue",
    an.ticket_booked AS "TicketBooked",
    an.call_outcome AS "CallOutcome",
    an.summary AS "Summary",
    an.transcript AS "Transcript",
    h.recording_url AS "CallRecording"
  FROM fujitsu_data.hangups h
  JOIN fujitsu_data.conversations c ON h.call_uuid = c.call_uuid
  LEFT JOIN fujitsu_data.analysis an ON h.call_uuid = an.call_uuid
  WHERE c.agent_id = $1
  ORDER BY h.created_at DESC
  LIMIT $2 OFFSET $3',
  dashboard_logs_query = 'SELECT
    to_char(h.created_at, ''DD Mon YYYY'') AS "Date",
    to_char(h.created_at, ''HH24:MI:SS'') AS "Time",
    to_char(h.created_at, ''HH24:MI:SS'') AS "StartTime",
    to_char(h.hangup_time, ''HH24:MI:SS'') AS "EndTime",
    h.mobile_number AS "CustomerNumber",
    h.status AS "CallStatus",
    CASE
      WHEN h.hangup_time IS NOT NULL THEN to_char(h.hangup_time - h.created_at, ''MI"m "SS"s"'')
      ELSE ''0m 0s''
    END AS "TotalDuration",
    h.recording_url AS "CallRecording"
  FROM fujitsu_data.hangups h
  JOIN fujitsu_data.conversations c ON h.call_uuid = c.call_uuid
  WHERE c.agent_id = $1
  ORDER BY h.created_at DESC
  LIMIT $2 OFFSET $3'
WHERE external_ref = 'Fujitsu';
