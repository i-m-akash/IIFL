-- IIFL Samasta: DE-approved campaign list (Q1/Q2) + batch-scoped logs/analytics (Q3–Q6)
PRAGMA foreign_keys = ON;

ALTER TABLE bots ADD COLUMN campaign_list_query TEXT;

-- Customer agent: v_connect_customer
UPDATE bots SET
  campaign_list_query = 'SELECT
    d.batch_id,
    d.client_name,
    MIN(d.created_at)::date AS start_date,
    MAX(d.created_at)::date AS end_date,
    COUNT(DISTINCT d.reference_id) AS total_triggered,
    COUNT(DISTINCT fac.call_uuid) AS answered_calls,
    COUNT(DISTINCT fuc.call_uuid) AS unanswered_calls
  FROM vconnect_data.dump_lead_info d
  LEFT JOIN vconnect_data.fact_answered_customer fac
    ON fac.batch_id = d.batch_id AND fac.agent_id = d.agent_id AND fac.date = $2
  LEFT JOIN vconnect_data.fact_unanswered_calls fuc
    ON fuc.batch_id = d.batch_id AND fuc.agent_id = d.agent_id AND fuc.date = $2
  WHERE d.agent_id = $1 AND d.created_at::date = $2
  GROUP BY d.batch_id, d.client_name
  ORDER BY MIN(d.created_at) DESC',
  dashboard_analytics_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    l.batch_id AS "BatchId",
    l.client_name AS "ClientName",
    COALESCE(l.name, ''Unknown'') AS "CustomerName",
    l.mobile_number AS "CustomerNumber",
    (floor(COALESCE(h.total_duration,0)/60))::text || ''m '' || (COALESCE(h.total_duration,0) % 60)::text || ''s'' AS "Duration",
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
  WHERE l.agent_id = $1 AND l.batch_id = $2
  ORDER BY h.start_time::timestamp DESC
  LIMIT $3 OFFSET $4',
  dashboard_logs_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "StartTime",
    to_char(h.end_time::timestamp, ''HH24:MI:SS'') AS "EndTime",
    l.batch_id AS "BatchId",
    l.direction AS "Direction",
    COALESCE(l.mobile_number, h.from_number) AS "CustomerNumber",
    COALESCE(l.name, ''Unknown'') AS "CustomerName",
    l.client_name AS "ClientName",
    h.call_status AS "CallStatus",
    (floor(COALESCE(h.total_duration,0)/60))::text || ''m '' || (COALESCE(h.total_duration,0) % 60)::text || ''s'' AS "TotalDuration",
    (floor(COALESCE(h.talk_time_duration,0)/60))::text || ''m '' || (COALESCE(h.talk_time_duration,0) % 60)::text || ''s'' AS "TalkTimeDuration",
    (floor(COALESCE(h.ringing_duration,0)/60))::text || ''m '' || (COALESCE(h.ringing_duration,0) % 60)::text || ''s'' AS "RingingDuration",
    h.hangup_cause_name AS "HangupCauseName",
    h.hangup_source AS "HangupSource",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  WHERE l.agent_id = $1 AND l.batch_id = $2
  ORDER BY h.start_time::timestamp DESC
  LIMIT $3 OFFSET $4'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_customer';

-- Employee agent: v_connect_employee
UPDATE bots SET
  campaign_list_query = 'SELECT
    d.batch_id,
    d.client_name,
    MIN(d.created_at)::date AS start_date,
    MAX(d.created_at)::date AS end_date,
    COUNT(DISTINCT d.reference_id) AS total_triggered,
    COUNT(DISTINCT fae.call_uuid) AS answered_calls,
    COUNT(DISTINCT fuc.call_uuid) AS unanswered_calls
  FROM vconnect_data.dump_lead_info d
  LEFT JOIN vconnect_data.fact_answered_employee fae
    ON fae.batch_id = d.batch_id AND fae.agent_id = d.agent_id AND fae.date = $2
  LEFT JOIN vconnect_data.fact_unanswered_calls fuc
    ON fuc.batch_id = d.batch_id AND fuc.agent_id = d.agent_id AND fuc.date = $2
  WHERE d.agent_id = $1 AND d.created_at::date = $2
  GROUP BY d.batch_id, d.client_name
  ORDER BY MIN(d.created_at) DESC',
  dashboard_analytics_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    l.batch_id AS "BatchId",
    l.client_name AS "ClientName",
    COALESCE(l.name, ''Unknown'') AS "EmployeeName",
    l.mobile_number AS "EmployeeNumber",
    (floor(COALESCE(h.total_duration,0)/60))::text || ''m '' || (COALESCE(h.total_duration,0) % 60)::text || ''s'' AS "Duration",
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
  WHERE l.agent_id = $1 AND l.batch_id = $2
  ORDER BY h.start_time::timestamp DESC
  LIMIT $3 OFFSET $4',
  dashboard_logs_query = 'SELECT
    to_char(h.start_time::timestamp, ''DD Mon YYYY'') AS "Date",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "Time",
    to_char(h.start_time::timestamp, ''HH24:MI:SS'') AS "StartTime",
    to_char(h.end_time::timestamp, ''HH24:MI:SS'') AS "EndTime",
    l.batch_id AS "BatchId",
    l.direction AS "Direction",
    COALESCE(l.mobile_number, h.from_number) AS "EmployeeNumber",
    COALESCE(l.name, ''Unknown'') AS "EmployeeName",
    l.client_name AS "ClientName",
    h.call_status AS "CallStatus",
    (floor(COALESCE(h.total_duration,0)/60))::text || ''m '' || (COALESCE(h.total_duration,0) % 60)::text || ''s'' AS "TotalDuration",
    (floor(COALESCE(h.talk_time_duration,0)/60))::text || ''m '' || (COALESCE(h.talk_time_duration,0) % 60)::text || ''s'' AS "TalkTimeDuration",
    (floor(COALESCE(h.ringing_duration,0)/60))::text || ''m '' || (COALESCE(h.ringing_duration,0) % 60)::text || ''s'' AS "RingingDuration",
    h.hangup_cause_name AS "HangupCauseName",
    h.hangup_source AS "HangupSource",
    h.recording_url AS "CallRecording"
  FROM vconnect_data.hangup_data h
  JOIN vconnect_data.lead_info l ON h.call_uuid = l.call_uuid
  WHERE l.agent_id = $1 AND l.batch_id = $2
  ORDER BY h.start_time::timestamp DESC
  LIMIT $3 OFFSET $4'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_employee';
