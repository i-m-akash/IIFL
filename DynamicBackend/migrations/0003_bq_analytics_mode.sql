ALTER TABLE admins ADD COLUMN bq_analytics_mode text NOT NULL DEFAULT 'joined_metadata';

UPDATE admins
SET
  bq_project_id = 'data-pipeline-426110',
  bq_dataset_id = 'Accelbiz_Call_Data',
  bq_analytics_mode = 'hangup_fact_answered'
WHERE slug = 'accelbiz';
