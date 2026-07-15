PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN must_change_password integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login_at integer;

UPDATE users
SET
  name = CASE
    WHEN role = 'client' THEN 'Client User'
    WHEN lower(email) LIKE 'admin@%' THEN 'Admin User'
    ELSE substr(email, 1, instr(email, '@') - 1)
  END,
  status = 'active',
  must_change_password = 0
WHERE coalesce(name, '') = '';