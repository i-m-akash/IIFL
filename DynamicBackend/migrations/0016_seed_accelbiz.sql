-- Accelbiz: Postgres datasource + dashboard queries (run against D1)
-- Params: $1 = agent external_ref, $2 = LIMIT, $3 = OFFSET

UPDATE admins
SET
  datasource_binding = 'ACCELBIZ_DB',
  postgres_schema = 'accelbiz_data',
  postgres_lead_table = 'dump_lead_info',
  analytics_source = 'postgres'
WHERE slug = 'accelbiz';

UPDATE bots
SET
  dashboard_analytics_query = 'SELECT
    TO_CHAR(date::DATE, ''DD Mon YYYY'') AS "Date",
    TO_CHAR(time::TIME, ''HH24:MI:SS'') AS "Time",
    reference_id AS "ReferenceID",
    batch_id AS "BatchID",
    client_name AS "ClientName",
    COALESCE(customer_name, ''N/A'') AS "CustomerName",
    customer_number AS "CustomerNumber",
    TO_CHAR(
      (COALESCE(NULLIF(call_duration, ''''), ''0'')::INT
      || '' SECONDS'')::INTERVAL,
      ''MI"m "SS"s"''
    ) AS "Duration",
    hangup_source AS "HangupSource",
    hangup_cause_name AS "HangupReason",
    call_purpose AS "CallPurpose",
    loan_type AS "LoanType",
    loan_amount AS "LoanAmount",
    customer_satisfaction AS "Satisfaction",
    sentiment AS "Sentiment",
    call_outcome AS "CallOutcome",
    willing_to_pay AS "WillingToPay",
    mode_of_payment AS "PaymentMode",
    payment_timeline AS "PaymentTimeline",
    payment_date AS "PaymentDate",
    payable_amount AS "PayableAmount",
    reason_for_non_payment AS "DelayReason",
    callback_requested AS "CallbackRequested",
    callback_datetime AS "CallbackDateTime",
    callback_reason AS "CallbackReason",
    preferred_language AS "PreferredLanguage",
    summary AS "Summary",
    transcript AS "Transcript",
    recording AS "CallRecording"
  FROM accelbiz_data.fact_answered_calls
  WHERE COALESCE(NULLIF(TRIM(agent_id), ''''), client_name) = $1
  ORDER BY date DESC, time DESC
  LIMIT $2 OFFSET $3',
  dashboard_logs_query = 'SELECT
    TO_CHAR(f.date::DATE, ''DD Mon YYYY'') AS "Date",
    TO_CHAR(f.time::TIME, ''HH24:MI:SS'') AS "Time",
    f.reference_id AS "ReferenceID",
    f.batch_id AS "BatchID",
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
  WHERE COALESCE(NULLIF(TRIM(f.agent_id), ''''), f.client_name) = $1
  ORDER BY f.date DESC, f.time DESC
  LIMIT $2 OFFSET $3'
WHERE admin_id = 't0000001-0000-4000-8000-000000000001';
