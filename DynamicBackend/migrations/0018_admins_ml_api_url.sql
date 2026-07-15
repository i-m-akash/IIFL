-- Per-admin ML dialer base (full URL to POST /call_customers). Accelbiz uses the stack on its DB host.
PRAGMA foreign_keys = ON;

ALTER TABLE admins ADD COLUMN ml_api_url TEXT;

-- Accelbiz / IIFL HTTPS URLs: migrations 0023 and 0021 (nestalab.com hostnames).
