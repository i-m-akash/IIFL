PRAGMA foreign_keys = ON;

-- =============================================================
-- Seed Fujitsu Agent for General HVAC India
-- =============================================================
INSERT INTO bots (
  id,
  admin_id,
  client_id,
  name,
  external_ref,
  meta_json,
  created_at
) VALUES (
  'b0000004-0000-4000-8000-000000000001',
  'a0000003-0000-4000-8000-000000000001',
  'c0000003-0000-4000-8000-000000000001',
  'Fujitsu Telephony',
  'Fujitsu',
  '{"description":"Inbound analytics agent"}',
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, external_ref) DO UPDATE SET
  name = excluded.name,
  client_id = excluded.client_id;
