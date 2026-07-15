PRAGMA foreign_keys = ON;

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'c0000002-0000-4000-8000-000000000001',
  'a0000002-0000-4000-8000-000000000001',
  'Towner Taxi',
  strftime('%s', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name;
