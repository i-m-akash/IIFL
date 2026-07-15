PRAGMA foreign_keys = ON;

INSERT INTO admins (
  id,
  slug,
  name,
  logo_url,
  primary_color,
  secondary_color,
  nav_bg_color,
  font_family,
  bq_project_id,
  bq_dataset_id,
  bq_analytics_mode,
  created_at
)
VALUES (
  'a0000002-0000-4000-8000-000000000001',
  'Towner_Taxi',
  'Towner Taxi',
  '/towner-logo.png',
  '#0f172a',
  '#22c55e',
  '#F8FAFC',
  'Poppins, system-ui, sans-serif',
  'data-pipeline-426110',
  'Towner_Call_Data',
  'hangup_towner_answered',
  strftime('%s', 'now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  logo_url = excluded.logo_url,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  nav_bg_color = excluded.nav_bg_color,
  font_family = excluded.font_family,
  bq_project_id = excluded.bq_project_id,
  bq_dataset_id = excluded.bq_dataset_id,
  bq_analytics_mode = excluded.bq_analytics_mode;

INSERT INTO users (id, admin_id, email, password_hash, role, client_id, created_at)
VALUES (
  'u0000003-0000-4000-8000-000000000001',
  'a0000002-0000-4000-8000-000000000001',
  'admin@towner.local',
  'pbkdf2$100000$YWNjZWxiaXotZGVtby1zYWx0LXYx$+A1+ePXszZeVVVszrlDbJ61B6BZKswprjRKbQ/jk+Eg=',
  'admin',
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT DO NOTHING;

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'b0000003-0000-4000-8000-000000000001',
  'a0000002-0000-4000-8000-000000000001',
  NULL,
  'Towner Taxi',
  'Towner_Taxi',
  '{"type":"AI Voice Assistant","description":"AI voice assistant designed to educate and onboard drivers to Towner Taxi''s commission-free digital meter platform.","status":"active"}',
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, external_ref) DO UPDATE SET
  name = excluded.name,
  meta_json = excluded.meta_json;
