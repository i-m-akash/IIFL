-- Accelbiz: ML dialer via HTTPS hostname (Cloudflare-friendly), not raw EC2 IP.
PRAGMA foreign_keys = ON;

UPDATE admins
SET ml_api_url = 'https://accelbiz.nestalab.com/call_customers'
WHERE slug = 'accelbiz' OR id = 't0000001-0000-4000-8000-000000000001';
