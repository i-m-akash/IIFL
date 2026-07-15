-- IIFL Samasta: ML dialer via HTTPS hostname (Cloudflare-friendly), not raw EC2 IP.
PRAGMA foreign_keys = ON;

UPDATE admins
SET ml_api_url = 'https://vconnect.nestalab.com/call_customers'
WHERE slug = 'iiflsamasta' OR id = 'iiflsamasta';
