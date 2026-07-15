-- Undo mistaken VCONNECT_DB binding from 0015_accelbiz_datasource_routing (applied out of order).
UPDATE admins
SET
  datasource_binding = 'ACCELBIZ_DB',
  postgres_schema = 'accelbiz_data',
  postgres_lead_table = 'dump_lead_info',
  analytics_source = 'hyperdrive_postgres'
WHERE slug = 'accelbiz';
