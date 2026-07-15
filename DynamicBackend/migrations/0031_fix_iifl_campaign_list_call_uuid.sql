-- Fix IIFL campaign list queries: dump_lead_info has reference_id, not call_uuid
PRAGMA foreign_keys = ON;

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
  ORDER BY MIN(d.created_at) DESC'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_customer';

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
  ORDER BY MIN(d.created_at) DESC'
WHERE admin_id = 'iiflsamasta' AND external_ref = 'v_connect_employee';
