PRAGMA foreign_keys = ON;

-- =============================================================
-- Mobicule account
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
  analytics_source,
  datasource_binding,
  postgres_schema,
  postgres_lead_table,
  ml_api_url,
  created_at
) VALUES (
  'mobicule',
  'mobicule',
  'Mobicule',
  '/mobicule-logo.png',
  '#8A3D96',
  '#B061BA',
  '#FAF5FF',
  'Poppins, system-ui, sans-serif',
  'd1',
  NULL,
  NULL,
  NULL,
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  logo_url = excluded.logo_url,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  nav_bg_color = excluded.nav_bg_color,
  font_family = excluded.font_family,
  ml_api_url = NULL;

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'mobicule-client',
  'mobicule',
  'Mobicule',
  strftime('%s', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name;

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
  'mobicule-admin-user',
  'mobicule',
  'Mobicule Admin',
  'admin@mobicule.local',
  'pbkdf2$100000$yCBSWaN3R6a5uiM5Rvgp3Q==$BDb1g8lk+LpR9rJF3rSwwle4clIaik/A0xLODbzwwLE=',
  'admin',
  'active',
  1,
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, email) DO NOTHING;

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES
  ('mobicule-bot-loan', 'mobicule', 'mobicule-client', 'Mobicule Loan', 'mobicule_loan', '{"type":"AI Voice Agent","description":"Mobicule loan agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-emi', 'mobicule', 'mobicule-client', 'Mobicule EMI', 'mobicule_emi', '{"type":"AI Voice Agent","description":"Mobicule EMI agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-postdue', 'mobicule', 'mobicule-client', 'Mobicule Postdue', 'mobicule_postdue', '{"type":"AI Voice Agent","description":"Mobicule postdue agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-mfl-postdue', 'mobicule', 'mobicule-client', 'MFL Postdue', 'mfl_postdue', '{"type":"AI Voice Agent","description":"MFL postdue agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-new-postdue', 'mobicule', 'mobicule-client', 'Mobicule New Postdue', 'mob_new_postdue', '{"type":"AI Voice Agent","description":"Mobicule new postdue agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-pre-due-kotak', 'mobicule', 'mobicule-client', 'Kotak Pre Due', 'pre-due-kotak', '{"type":"AI Voice Agent","description":"Kotak pre-due agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-pre-due-kotak-npdc', 'mobicule', 'mobicule-client', 'Kotak Pre Due NPDC', 'pre-due-kotak-npdc', '{"type":"AI Voice Agent","description":"Kotak pre-due NPDC agent","status":"active"}', strftime('%s', 'now')),
  ('mobicule-bot-post-due-kotak', 'mobicule', 'mobicule-client', 'Kotak Post Due', 'post-due-kotak', '{"type":"AI Voice Agent","description":"Kotak post-due agent","status":"active"}', strftime('%s', 'now'))
ON CONFLICT(admin_id, external_ref) DO UPDATE SET
  name = excluded.name,
  client_id = excluded.client_id,
  meta_json = excluded.meta_json;

-- =============================================================
-- MakeMyTrip account
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
  analytics_source,
  datasource_binding,
  postgres_schema,
  postgres_lead_table,
  ml_api_url,
  created_at
) VALUES (
  'makemytrip',
  'makemytrip',
  'MakeMyTrip',
  '/makemytrip-logo.png',
  '#174E86',
  '#D7351C',
  '#F3F8FD',
  'Poppins, system-ui, sans-serif',
  'd1',
  NULL,
  NULL,
  NULL,
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  logo_url = excluded.logo_url,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  nav_bg_color = excluded.nav_bg_color,
  font_family = excluded.font_family,
  ml_api_url = NULL;

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'makemytrip-client',
  'makemytrip',
  'MakeMyTrip',
  strftime('%s', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name;

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
  'makemytrip-admin-user',
  'makemytrip',
  'MakeMyTrip Admin',
  'admin@makemytrip.local',
  'pbkdf2$100000$5r6sNBAmQc4zChmHz5qmDw==$ynS/TrW1vLHce191l6Pu9xEl2zEMBonyEr1m3rm+2uE=',
  'admin',
  'active',
  1,
  NULL,
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, email) DO NOTHING;

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'makemytrip-bot-booking-check',
  'makemytrip',
  'makemytrip-client',
  'MakeMyTrip Booking Check',
  'mmtbookingcheck',
  '{"type":"AI Voice Agent","description":"MakeMyTrip booking check agent","status":"active"}',
  strftime('%s', 'now')
)
ON CONFLICT(admin_id, external_ref) DO UPDATE SET
  name = excluded.name,
  client_id = excluded.client_id,
  meta_json = excluded.meta_json;
