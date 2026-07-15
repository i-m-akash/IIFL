PRAGMA foreign_keys = ON;

UPDATE admins
SET
  analytics_source = 'hyperdrive_postgres',
  datasource_binding = 'VCONNECT_DB'
WHERE slug = 'accelbiz';
