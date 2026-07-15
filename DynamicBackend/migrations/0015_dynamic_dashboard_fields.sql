ALTER TABLE admins ADD COLUMN postgres_schema text;
ALTER TABLE admins ADD COLUMN postgres_lead_table text;
ALTER TABLE bots ADD COLUMN dashboard_analytics_query text;
ALTER TABLE bots ADD COLUMN dashboard_logs_query text;
