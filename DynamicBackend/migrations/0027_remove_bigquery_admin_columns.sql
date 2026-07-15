-- Dashboards use Hyperdrive Postgres only; drop legacy BigQuery admin columns.

UPDATE admins
SET
  bq_project_id = NULL,
  bq_dataset_id = NULL
WHERE bq_project_id IS NOT NULL OR bq_dataset_id IS NOT NULL;

UPDATE admins
SET analytics_source = 'hyperdrive_postgres'
WHERE datasource_binding IS NOT NULL
  AND analytics_source IN ('postgres', 'bigquery', 'bq');

ALTER TABLE admins DROP COLUMN bq_project_id;
ALTER TABLE admins DROP COLUMN bq_dataset_id;
ALTER TABLE admins DROP COLUMN bq_analytics_mode;
