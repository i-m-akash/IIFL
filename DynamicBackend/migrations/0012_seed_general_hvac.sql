PRAGMA foreign_keys = ON;

-- =============================================================
-- General HVAC India (new tenant)
-- =============================================================
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
) VALUES (
  'a0000003-0000-4000-8000-000000000001',
  'general_hvac_in',
  'General HVAC India',
  '/general-hvac-logo.svg',
  '#FF0000',
  '#C40000',
  '#FFF5F5',
  'Poppins, system-ui, sans-serif',
  NULL,
  NULL,
  'joined_metadata',
  strftime('%s', 'now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  logo_url = excluded.logo_url,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  nav_bg_color = excluded.nav_bg_color,
  font_family = excluded.font_family,
  bq_analytics_mode = excluded.bq_analytics_mode;

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'c0000003-0000-4000-8000-000000000001',
  'a0000003-0000-4000-8000-000000000001',
  'General HVAC India',
  strftime('%s', 'now')
)
ON CONFLICT(id) DO NOTHING;

INSERT INTO users (
  id,
  admin_id,
  name,
  email,
  password_hash,
  role,
  status,
  must_change_password,
  client_id,
  created_at
) VALUES (
  'u0000004-0000-4000-8000-000000000001',
  'a0000003-0000-4000-8000-000000000001',
  'General HVAC Admin',
  'admin@general-hvac.local',
  'pbkdf2$100000$K8kPEcGPWKfU60NVlJh8Qg==$jCMeTHa8klB5MX3gWfVi9wYFE85RHTOwLxk+WmJ0ai4=',
  'admin',
  'active',
  1,
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, email) DO NOTHING;

-- =============================================================
-- Accelbiz (re-seed / upsert) -- originally 0002, 0004
-- =============================================================
INSERT INTO admins (
  id, slug, name, logo_url,
  primary_color, secondary_color, nav_bg_color, font_family,
  bq_project_id, bq_dataset_id, bq_analytics_mode, created_at
) VALUES (
  't0000001-0000-4000-8000-000000000001',
  'accelbiz',
  'Accelbiz',
  '/accelbiz-logo.png',
  '#059669',
  '#0ea5e9',
  '#F2F7FA',
  'Poppins, system-ui, sans-serif',
  NULL,
  NULL,
  'joined_metadata',
  strftime('%s', 'now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  logo_url = excluded.logo_url,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  nav_bg_color = excluded.nav_bg_color,
  font_family = excluded.font_family;

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'c0000001-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  'Demo Client',
  strftime('%s', 'now')
)
ON CONFLICT(id) DO NOTHING;

-- =============================================================
-- Towner Taxi (re-seed / upsert) -- originally 0006
-- =============================================================
INSERT INTO admins (
  id, slug, name, logo_url,
  primary_color, secondary_color, nav_bg_color, font_family,
  bq_project_id, bq_dataset_id, bq_analytics_mode, created_at
) VALUES (
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
