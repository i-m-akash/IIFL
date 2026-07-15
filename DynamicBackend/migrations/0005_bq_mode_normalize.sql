UPDATE admins
SET bq_analytics_mode = 'joined_metadata'
WHERE bq_analytics_mode = 'mobicule_join';

UPDATE admins
SET bq_analytics_mode = 'flat_analysis'
WHERE bq_analytics_mode = 'flat_call_analysis';

UPDATE admins
SET bq_analytics_mode = 'hangup_fact_answered'
WHERE slug = 'accelbiz';
