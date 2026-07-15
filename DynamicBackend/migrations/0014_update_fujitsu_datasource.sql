PRAGMA foreign_keys = ON;

UPDATE admins 
SET datasource_binding = 'FUJITSU_DB' 
WHERE slug = 'general_hvac_in';
