PRAGMA foreign_keys = ON;

INSERT INTO admins (id, slug, name, logo_url, primary_color, secondary_color, nav_bg_color, font_family, bq_project_id, bq_dataset_id, created_at)
VALUES (
  't0000001-0000-4000-8000-000000000001',
  'accelbiz',
  'Accelbiz',
  NULL,
  '#059669',
  '#0ea5e9',
  '#F2F7FA',
  'Poppins, system-ui, sans-serif',
  NULL,
  NULL,
  strftime('%s', 'now')
);

INSERT INTO clients (id, admin_id, name, created_at)
VALUES (
  'c0000001-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  'Demo Client',
  strftime('%s', 'now')
);

INSERT INTO users (id, admin_id, email, password_hash, role, client_id, created_at)
VALUES (
  'u0000001-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  'admin@accelbiz.local',
  'pbkdf2$100000$YWNjZWxiaXotZGVtby1zYWx0LXYx$+A1+ePXszZeVVVszrlDbJ61B6BZKswprjRKbQ/jk+Eg=',
  'admin',
  NULL,
  strftime('%s', 'now')
);

INSERT INTO users (id, admin_id, email, password_hash, role, client_id, created_at)
VALUES (
  'u0000002-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  'client@accelbiz.local',
  'pbkdf2$100000$YWNjZWxiaXotZGVtby1zYWx0LXYx$+A1+ePXszZeVVVszrlDbJ61B6BZKswprjRKbQ/jk+Eg=',
  'client',
  'c0000001-0000-4000-8000-000000000001',
  strftime('%s', 'now')
);

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'b0000001-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  'c0000001-0000-4000-8000-000000000001',
  'Accel Biz Predue Agent',
  'accel_biz_emi_predue',
  '{"type":"Financial Service Agent","description":"Predue Agent used for EMI collection.","status":"active"}',
  strftime('%s', 'now')
);

INSERT INTO bots (id, admin_id, client_id, name, external_ref, meta_json, created_at)
VALUES (
  'b0000002-0000-4000-8000-000000000001',
  't0000001-0000-4000-8000-000000000001',
  NULL,
  'Accel Biz Postdue Agent',
  'accel_biz_emi_postdue',
  '{"type":"Financial Service Agent","description":"Postdue Agent used for EMI collection.","status":"active"}',
  strftime('%s', 'now')
);

INSERT INTO bot_call_logs (id, admin_id, bot_id, client_id, occurred_at, direction, customer_number, duration_sec, action_summary, meta_json)
VALUES
  ('l0000001-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', strftime('%s', 'now') - 3600, 'outbound', '+919876543210', 185, 'EMI reminder completed', NULL),
  ('l0000002-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', strftime('%s', 'now') - 7200, 'inbound', '+919811122233', 92, 'Answered', '{"CallForwardedTo":"Support"}');

INSERT INTO bot_analytics_rows (id, admin_id, bot_id, client_id, occurred_at, meta_json)
VALUES
  ('n0000001-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', strftime('%s', 'now') - 3600,
   '{"customerName":"Ravi Kumar","customerNumber":"+919876543210","clientName":"Demo Client","loanType":"Personal","emiAmount":"12500","sentiment":"positive","callOutcome":"Promised to pay by 25th","summary":"Customer agreed to EMI schedule.","preferredLanguage":"Hindi","callPurpose":"EMI reminder","customerSatisfaction":"High","willingToPay":"Yes","paymentTimeline":"Within 7 days","modeOfPayment":"UPI","paymentDate":"","payableAmount":"12500","reasonForNonPayment":"","callbackRequested":"No","callbackDatetime":"","callbackReason":"","transcript":"","callRecording":""}'),
  ('n0000002-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', strftime('%s', 'now') - 8000,
   '{"customerName":"Sita Devi","customerNumber":"+919811122233","clientName":"Demo Client","loanType":"Gold","emiAmount":"8200","sentiment":"neutral","callOutcome":"Callback requested","summary":"Asked to call back evening.","preferredLanguage":"Telugu","callPurpose":"Follow-up","customerSatisfaction":"Medium","willingToPay":"Maybe","paymentTimeline":"","modeOfPayment":"","paymentDate":"","payableAmount":"","reasonForNonPayment":"","callbackRequested":"Yes","callbackDatetime":"","callbackReason":"Evening hours","transcript":"","callRecording":""}');

INSERT INTO campaign_leads (id, admin_id, client_id, bot_id, reference_id, party_name, party_mobile, emi_amount, emi_date, loan_type, preferred_language, call_status, scheduled_at, file_name, upload_batch_id, created_at)
VALUES
  ('p0000001-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'REF-1001', 'Ravi Kumar', '+919876543210', '12500', '15-01-2026', 'Personal', 'Hindi', 'pending', strftime('%s', 'now') + 3600, 'demo.csv', 'batch-accel-1', strftime('%s', 'now')),
  ('p0000002-0000-4000-8000-000000000001', 't0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000001', 'REF-1002', 'Sita Devi', '+919811122233', '8200', '20-01-2026', 'Gold', 'Telugu', 'completed', strftime('%s', 'now') - 3600, 'demo.csv', 'batch-accel-1', strftime('%s', 'now'));
