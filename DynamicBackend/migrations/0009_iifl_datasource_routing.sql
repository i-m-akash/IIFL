PRAGMA foreign_keys = ON;

ALTER TABLE admins ADD COLUMN analytics_source TEXT DEFAULT 'd1';
ALTER TABLE admins ADD COLUMN datasource_binding TEXT;

UPDATE admins
SET
  analytics_source = 'hyperdrive_postgres',
  datasource_binding = 'VCONNECT_DB'
WHERE id = 'iiflsamasta';