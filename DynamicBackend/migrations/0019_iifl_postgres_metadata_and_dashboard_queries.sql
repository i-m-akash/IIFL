-- Ported from seed_iifl.sql: tenant Postgres metadata + dashboard SQL for IIFL Samasta bots
-- (targets rows created in 0008_seed_iifl.sql by external_ref)
PRAGMA foreign_keys = ON;

UPDATE admins SET
  datasource_binding = 'VCONNECT_DB',
  postgres_schema = 'vconnect_data',
  postgres_lead_table = 'dump_lead_info'
WHERE id = 'iiflsamasta';

UPDATE bots SET
  name = 'IIFL SAMASTA Finance (Customer)',
  meta_json = '{"type":"Customer Feedback Agent","description":"Handles customer call analytics and feedback","status":"active"}',
  dashboard_analytics_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    l.client_name AS "ClientName",
    COALESCE(l.name, ''Unknown'') AS "CustomerName",
    l.mobile_number AS "CustomerNumber",
    (floor(COALESCE(h.total_duration, 0) / 60))::text || ''m '' || (COALESCE(h.total_duration, 0) % 60)::text || ''s'' AS "Duration",
    h.call_status AS "CallStatus",
    ac.sentiment AS "Sentiment",
    ac.call_purpose AS "CallPurpose",
    ac.call_outcome AS "CallOutcome",
    ac.summary AS "Summary",
    ac.transcript AS "Transcript",
    ac.competitor_name AS "CompetitorName",
    ac.retention_suggestion AS "RetentionSuggestion",
    ac.service_issue_type AS "ServiceIssueType",
    ac.reason_for_closing_loan AS "ClosureReason",
    ac.callback_requested AS "CallbackRequested",
    ac.callback_datetime AS "CallbackDatetime",
    ac.callback_reason AS "CallbackReason",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  JOIN vconnect_data.call_analysis_customer ac ON h.call_uuid = ac.call_uuid
  WHERE l.agent_id = $1
  ORDER BY h.start_time::timestamp DESC
  LIMIT $2 OFFSET $3',
  dashboard_logs_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "StartTime",
    to_char(h.end_time::timestamp, ''HH24:MI:SS'') AS "EndTime",
    l.direction AS "Direction",
    COALESCE(l.mobile_number, h.from_number) AS "CustomerNumber",
    COALESCE(l.name, ''Unknown'') AS "CustomerName",
    l.client_name AS "ClientName",
    h.call_status AS "CallStatus",
    (floor(COALESCE(h.total_duration, 0) / 60))::text || ''m '' || (COALESCE(h.total_duration, 0) % 60)::text || ''s'' AS "TotalDuration",
    (floor(COALESCE(h.talk_time_duration, 0) / 60))::text || ''m '' || (COALESCE(h.talk_time_duration, 0) % 60)::text || ''s'' AS "TalkTimeDuration",
    (floor(COALESCE(h.ringing_duration, 0) / 60))::text || ''m '' || (COALESCE(h.ringing_duration, 0) % 60)::text || ''s'' AS "RingingDuration",
    h.hangup_cause_name AS "HangupCauseName",
    h.hangup_source AS "HangupSource",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  WHERE l.agent_id = $1
  ORDER BY h.start_time::timestamp DESC
  LIMIT $2 OFFSET $3'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_customer';

UPDATE bots SET
  name = 'IIFL SAMASTA HO (Employee)',
  meta_json = '{"type":"Employee Feedback Agent","description":"Handles employee call analytics and feedback","status":"active"}',
  dashboard_analytics_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    l.client_name AS "ClientName",
    COALESCE(l.name, ''Unknown'') AS "EmployeeName",
    l.mobile_number AS "EmployeeNumber",
    (floor(COALESCE(h.total_duration, 0) / 60))::text || ''m '' || (COALESCE(h.total_duration, 0) % 60)::text || ''s'' AS "Duration",
    h.call_status AS "CallStatus",
    ae.is_meaningful_interaction AS "IsMeaningfulInteraction",
    ae.sentiment AS "Sentiment",
    ae.call_purpose AS "CallPurpose",
    ae.call_outcome AS "CallOutcome",
    ae.summary AS "Summary",
    ae.transcript AS "Transcript",
    ae.q1_retention_barriers AS "Q1_RetentionBarriers",
    ae.q2_data_quality_issues AS "Q2_DataQualityIssues",
    ae.q3_process_improvement AS "Q3_ProcessImprovement",
    ae.q4_system_feedback AS "Q4_SystemFeedback",
    ae.q5_customer_expectations AS "Q5_CustomerExpectations",
    ae.callback_requested AS "CallbackRequested",
    ae.callback_datetime AS "CallbackDatetime",
    ae.callback_reason AS "CallbackReason",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  JOIN vconnect_data.call_analysis_employee ae ON h.call_uuid = ae.call_uuid
  WHERE l.agent_id = $1
  ORDER BY h.start_time::timestamp DESC
  LIMIT $2 OFFSET $3',
  dashboard_logs_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "StartTime",
    to_char(h.end_time::timestamp, ''HH24:MI:SS'') AS "EndTime",
    l.direction AS "Direction",
    COALESCE(l.mobile_number, h.from_number) AS "EmployeeNumber",
    COALESCE(l.name, ''Unknown'') AS "EmployeeName",
    l.client_name AS "ClientName",
    h.call_status AS "CallStatus",
    (floor(COALESCE(h.total_duration, 0) / 60))::text || ''m '' || (COALESCE(h.total_duration, 0) % 60)::text || ''s'' AS "TotalDuration",
    (floor(COALESCE(h.talk_time_duration, 0) / 60))::text || ''m '' || (COALESCE(h.talk_time_duration, 0) % 60)::text || ''s'' AS "TalkTimeDuration",
    (floor(COALESCE(h.ringing_duration, 0) / 60))::text || ''m '' || (COALESCE(h.ringing_duration, 0) % 60)::text || ''s'' AS "RingingDuration",
    h.hangup_cause_name AS "HangupCauseName",
    h.hangup_source AS "HangupSource",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  WHERE l.agent_id = $1
  ORDER BY h.start_time::timestamp DESC
  LIMIT $2 OFFSET $3'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_employee';
