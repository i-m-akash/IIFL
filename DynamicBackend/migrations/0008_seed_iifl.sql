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
  'iiflsamasta',
  'iiflsamasta',
  'IIFL Samasta',
  '/IIFL_logo-2048x959.webp',
  '#046BD2',
  '#045CB4',
  '#F0F5FA',
  'Poppins, system-ui, sans-serif',
  NULL,
  NULL,
  'joined_metadata',
  strftime('%s', 'now')
);

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'iiflsamasta-client',
  'iiflsamasta',
  'IIFL Samasta',
  strftime('%s', 'now')
);

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
)
VALUES (
  'iiflsamasta-admin-user',
  'iiflsamasta',
  'IIFL Samasta Admin',
  'admin@iiflsamasta.local',
  'pbkdf2$100000$q8hMnlA2/aQGuz2w5GXAWA==$aCQ9++VjM0Y5Ide+qh8zxD6NBVpJgyEmiALBeufUBtA=',
  'admin',
  'active',
  0,
  NULL,
  strftime('%s', 'now')
);

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'iiflsamasta-bot-customer',
  'iiflsamasta',
  'iiflsamasta-client',
  'IIFL SAMASTA Finance',
  'v_connect_customer',
  '{"type":"Customer Feedback Agent","description":"customer feedback","status":"active"}',
  strftime('%s', 'now')
);

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'iiflsamasta-bot-employee',
  'iiflsamasta',
  'iiflsamasta-client',
  'IIFL SAMASTA HO',
  'v_connect_employee',
  '{"type":"Employee Feedback Agent","description":"employee feedback","status":"active"}',
  strftime('%s', 'now')
);