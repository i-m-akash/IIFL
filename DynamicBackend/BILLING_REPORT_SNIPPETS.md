# Billing Report — Code Snippets
> Extracted from `verbalyze-chat` for team reference.
> All billing logic is **admin-only**, date-filterable, and uses rounded-up minutes.

---

## 1. Backend — `app.py`

### API Endpoint: `GET /api/billing-report`

```python
# ── Billing Report endpoint ───────────────────────────────────────────
@app.get("/api/billing-report")
async def get_billing_report(
    date_from: Optional[str] = None,
    date_to:   Optional[str] = None,
    period:    str = "daily",          # "daily" | "weekly" | "monthly"
    exclude_under: int = 0,            # 0=all, 5=exclude<5s, 10=exclude<10s, 15=exclude<15s
    auth_token: Optional[str] = Cookie(None, alias=AUTH_COOKIE)
):
    """
    Billing report grouped by client_name + date (or week/month).
    Only counts answered calls with webhook_status = 'sent'.
    Billing logic: each call duration is rounded UP to the nearest 60s.
    If exclude_under_15 = 'true', calls with duration < 15s are excluded.
    Columns: client_name, call_date, total_calls, total_duration_seconds,
             total_bill_duration_seconds, total_bill_minutes
    """
    user = USERS_DB.get(auth_token or "")
    if not user:
        raise HTTPException(401, "Unauthorized")
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")

    ist = pytz.timezone("Asia/Kolkata")
    today = datetime.now(ist).strftime("%Y-%m-%d")
    d_from = date_from or (datetime.now(ist).replace(day=1).strftime("%Y-%m-%d"))
    d_to   = date_to or today
    excl   = max(0, int(exclude_under)) if str(exclude_under).isdigit() else 0

    # Build the date grouping expression
    if period == "monthly":
        date_expr = "TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM')"
        date_label = "month"
    elif period == "weekly":
        date_expr = "TO_CHAR(DATE_TRUNC('week', TO_DATE(date, 'YYYY-MM-DD')), 'YYYY-MM-DD')"
        date_label = "week_start"
    else:
        date_expr = "date"
        date_label = "call_date"

    # Duration filter — exclude calls shorter than excl seconds (0 = include all)
    dur_filter = "AND call_duration ~ '^[0-9]+(\\.[0-9]+)?$'"
    if excl > 0:
        dur_filter += f" AND CAST(call_duration AS FLOAT) >= {excl}"

    sql = f"""
    SELECT
        client_name,
        {date_expr} AS call_date,
        COUNT(DISTINCT call_uuid) AS total_calls,
        ROUND(SUM(CAST(call_duration AS FLOAT))::numeric, 0)::bigint AS total_duration_seconds,
        SUM(CEIL(CAST(call_duration AS FLOAT) / 60.0) * 60)::bigint AS total_bill_duration_seconds,
        SUM(CEIL(CAST(call_duration AS FLOAT) / 60.0))::bigint AS total_bill_minutes
    FROM mobicule_data.fact_answered_calls
    WHERE date BETWEEN $1 AND $2
      AND LOWER(webhook_status) = 'sent'
      AND call_duration IS NOT NULL
      {dur_filter}
    GROUP BY client_name, {date_expr}
    ORDER BY client_name, call_date
    """

    pool = await get_pg_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, d_from, d_to)
            data = [dict(r) for r in rows]

        # Grand total
        grand_total_calls    = sum(r["total_calls"] for r in data)
        grand_total_dur_secs = sum(r["total_duration_seconds"] for r in data)
        grand_total_bill_dur = sum(r["total_bill_duration_seconds"] for r in data)
        grand_total_bill_min = sum(r["total_bill_minutes"] for r in data)

        return {
            "date_from": d_from,
            "date_to": d_to,
            "period": period,
            "exclude_under": excl,
            "rows": data,
            "totals": {
                "total_calls": grand_total_calls,
                "total_duration_seconds": grand_total_dur_secs,
                "total_bill_duration_seconds": grand_total_bill_dur,
                "total_bill_minutes": grand_total_bill_min,
            }
        }
    except Exception as e:
        logging.error(f"Billing report error: {e}")
        raise HTTPException(500, f"Query failed: {str(e)}")
```

---

## 2. Frontend HTML — `static/index.html`

### Section HTML (inside Settings page)

```html
<!-- ── Billing Report (Admin only) ── -->
<div class="admin-only" id="billingReportSection" style="display:none;margin-top:28px;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
            <div style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a7fa5" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Billing Report
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Answered calls with
                webhook sent · Rounded up to nearest minute</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <!-- Period selector -->
            <select id="billingPeriod" onchange="loadBillingReport()"
                style="padding:6px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;font-family:'Inter',sans-serif;outline:none;">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
            </select>
            <!-- Date from -->
            <input type="date" id="billingDateFrom"
                style="padding:6px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;font-family:'Inter',sans-serif;outline:none;">
            <span style="font-size:12px;color:var(--text-muted);">to</span>
            <input type="date" id="billingDateTo"
                style="padding:6px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;font-family:'Inter',sans-serif;outline:none;">
            <button onclick="loadBillingReport()"
                style="padding:6px 12px;background:rgba(59,130,246,0.10);border:1px solid rgba(59,130,246,0.25);border-radius:8px;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;"
                onmouseover="this.style.background='rgba(59,130,246,0.18)'"
                onmouseout="this.style.background='rgba(59,130,246,0.10)'">Apply</button>
            <button onclick="clearBillingDates()"
                style="padding:6px 12px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.20);border-radius:8px;color:#dc2626;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;"
                onmouseover="this.style.background='rgba(220,38,38,0.14)'"
                onmouseout="this.style.background='rgba(220,38,38,0.08)'">Clear</button>
            <!-- Exclude short calls dropdown -->
            <select id="billingExcludeMin" onchange="loadBillingReport()"
                style="padding:6px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:12px;font-family:'Inter',sans-serif;outline:none;">
                <option value="0">All durations</option>
                <option value="5">Exclude &lt; 5s</option>
                <option value="10">Exclude &lt; 10s</option>
                <option value="15">Exclude &lt; 15s</option>
            </select>
            <!-- Refresh -->
            <button class="btn-refresh" onclick="refreshWithSpinner(this, refreshBillingToday)"
                title="Refresh — resets to today">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Refresh
            </button>
            <!-- Download buttons -->
            <span style="font-size:11px;font-weight:600;color:#3b82f6;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.15);padding:4px 10px;border-radius:7px;white-space:nowrap;">Download :</span>
            <button onclick="downloadBillingCsvPlain()"
                style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);border-radius:8px;color:#ea580c;font-size:11px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;">
                CSV
            </button>
            <button onclick="downloadBillingExcel()"
                style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);border-radius:8px;color:#16a34a;font-size:11px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;">
                Excel
            </button>
        </div>
    </div>
    <div id="billingReportContent">
        <div class="loading-row">
            <div class="spinner"></div>
        </div>
    </div>
</div>
```

---

## 3. Frontend JavaScript — `static/index.html` (inside `<script>`)

### Load & Render

```javascript
// ── Billing Report ──────────────────────────────────────────────
let _billingData = null;

function _billingDefaultDates() {
    const today = getTodayIST();  // IST (UTC+5:30)
    const firstOfMonth = today.slice(0, 7) + '-01';
    const fromEl = document.getElementById('billingDateFrom');
    const toEl = document.getElementById('billingDateTo');
    if (fromEl && !fromEl.value) fromEl.value = firstOfMonth;
    if (toEl && !toEl.value) toEl.value = today;
}

function clearBillingDates() {
    const today = getTodayIST();
    const fromEl = document.getElementById('billingDateFrom');
    const toEl = document.getElementById('billingDateTo');
    if (fromEl) fromEl.value = today;
    if (toEl) toEl.value = today;
    loadBillingReport();
}

function refreshBillingToday() {
    const today = getTodayIST();
    const fromEl = document.getElementById('billingDateFrom');
    const toEl = document.getElementById('billingDateTo');
    if (fromEl) fromEl.value = today;
    if (toEl) toEl.value = today;
    loadBillingReport();
}

async function loadBillingReport() {
    _billingDefaultDates();
    const el = document.getElementById('billingReportContent');
    if (!el) return;
    el.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    const period   = document.getElementById('billingPeriod')?.value || 'daily';
    const dateFrom = document.getElementById('billingDateFrom')?.value || '';
    const dateTo   = document.getElementById('billingDateTo')?.value || '';
    const excl15   = document.getElementById('billingExcludeMin')?.value || '0';

    try {
        let url = `/api/billing-report?period=${period}&exclude_under=${excl15}`;
        if (dateFrom) url += `&date_from=${dateFrom}`;
        if (dateTo)   url += `&date_to=${dateTo}`;
        const resp = await fetch(url);
        if (resp.status === 401) { window.location.href = '/login'; return; }
        if (resp.status === 403) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><h3>Admin access required</h3></div>'; return; }
        if (!resp.ok) throw new Error(await resp.text());
        const d = await resp.json();
        _billingData = d;
        _renderBillingTable(d, el);
    } catch (e) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Failed to load billing report</h3><p>${escH(e.message)}</p></div>`;
    }
}

function _renderBillingTable(d, el) {
    const rows   = d.rows || [];
    const totals = d.totals || {};
    const excl   = d.exclude_under || 0;
    const period = d.period;

    const dateLabel = period === 'monthly' ? 'Month' : period === 'weekly' ? 'Week Start' : 'Date';

    if (!rows.length) {
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><h3>No billing data for this period</h3><p>No answered calls with webhook sent found.</p></div>';
        return;
    }

    // Each client gets a distinct minimal color band
    const CLIENT_PALETTES = [
        { text: '#4a7fa5', bg: 'rgba(74,127,165,0.04)',   border: 'rgba(74,127,165,0.12)'   },  // steel blue
        { text: '#4a9e7a', bg: 'rgba(74,158,122,0.04)',   border: 'rgba(74,158,122,0.12)'   },  // sage green
        { text: '#c49a4a', bg: 'rgba(196,154,74,0.04)',   border: 'rgba(196,154,74,0.12)'   },  // warm amber
        { text: '#888888', bg: 'rgba(100,116,139,0.04)',  border: 'rgba(100,116,139,0.12)'  },  // slate gray
        { text: '#7aafc8', bg: 'rgba(122,175,200,0.04)',  border: 'rgba(122,175,200,0.12)'  },  // sky blue
        { text: '#9b7ec8', bg: 'rgba(155,126,200,0.04)',  border: 'rgba(155,126,200,0.12)'  },  // soft purple
        { text: '#5ba3b8', bg: 'rgba(91,163,184,0.04)',   border: 'rgba(91,163,184,0.12)'   },  // teal
        { text: '#c0504a', bg: 'rgba(192,80,74,0.04)',    border: 'rgba(192,80,74,0.12)'    },  // muted red
    ];
    const clientList = [...new Set(rows.map(r => r.client_name))];
    const clientPaletteMap = {};
    clientList.forEach((c, i) => { clientPaletteMap[c] = CLIENT_PALETTES[i % CLIENT_PALETTES.length]; });

    let prevClient = null;

    const tableRows = rows.map(r => {
        const isNewClient = r.client_name !== prevClient;
        prevClient = r.client_name;
        const pal = clientPaletteMap[r.client_name] || CLIENT_PALETTES[0];
        const rowBorderTop = isNewClient ? `border-top:2px solid ${pal.border};` : '';
        const clientCell = isNewClient
            ? `<td style="font-weight:700;color:${pal.text};white-space:nowrap;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${escH(r.client_name)}</td>`
            : `<td style="font-weight:400;color:${pal.text};opacity:0.7;font-size:11px;white-space:nowrap;background:${pal.bg};padding:9px 14px;">${escH(r.client_name)}</td>`;
        return `<tr style="background:${pal.bg};">
            ${clientCell}
            <td style="color:#444;font-size:12px;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${escH(String(r.call_date || '—'))}</td>
            <td style="font-weight:600;color:var(--text-primary);text-align:right;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${(r.total_calls || 0).toLocaleString()}</td>
            <td style="color:#555;text-align:right;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${(r.total_duration_seconds || 0).toLocaleString()}</td>
            <td style="color:${pal.text};font-weight:600;text-align:right;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${(r.total_bill_duration_seconds || 0).toLocaleString()}</td>
            <td style="font-weight:800;color:#15803d;text-align:right;font-size:14px;background:${pal.bg};${rowBorderTop}padding:9px 14px;">${(r.total_bill_minutes || 0).toLocaleString()}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--text-muted);">${rows.length} row(s) · ${d.date_from} → ${d.date_to} · ${period}</span>
        ${excl > 0 ? `<span style="font-size:11px;font-weight:600;color:#d97706;background:rgba(217,119,6,0.10);padding:2px 8px;border-radius:10px;">Excluding &lt;${excl}s calls</span>` : '<span style="font-size:11px;color:#555;background:rgba(0,0,0,0.05);padding:2px 8px;border-radius:10px;">Including all durations</span>'}
    </div>
    <div class="logs-table-wrap">
        <table class="logs-table">
            <thead>
                <tr>
                    <th>Client Name</th>
                    <th>${dateLabel}</th>
                    <th style="text-align:right;">Total Calls (Ans)</th>
                    <th style="text-align:right;">Total Duration (secs)</th>
                    <th style="text-align:right;">Total Bill Duration (secs)</th>
                    <th style="text-align:right;">Total Bill Minutes</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            <tfoot>
                <tr style="background:var(--bg-tertiary);border-top:2px solid var(--border-strong);">
                    <td colspan="2" style="font-weight:700;color:var(--text-primary);padding:10px 14px;">TOTAL</td>
                    <td style="font-weight:700;color:var(--text-primary);text-align:right;padding:10px 14px;">${(totals.total_calls || 0).toLocaleString()}</td>
                    <td style="font-weight:700;color:var(--text-primary);text-align:right;padding:10px 14px;">${(totals.total_duration_seconds || 0).toLocaleString()}</td>
                    <td style="font-weight:700;color:#4a7fa5;text-align:right;padding:10px 14px;">${(totals.total_bill_duration_seconds || 0).toLocaleString()}</td>
                    <td style="font-weight:800;color:#16a34a;text-align:right;padding:10px 14px;font-size:15px;">${(totals.total_bill_minutes || 0).toLocaleString()}</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}
```

### CSV Download

```javascript
// ── Plain CSV (no colors) ──
function downloadBillingCsv() { downloadBillingCsvPlain(); } // legacy alias

function downloadBillingCsvPlain() {
    if (!_billingData || !_billingData.rows || !_billingData.rows.length) {
        alert('No billing data to download. Please load the report first.');
        return;
    }
    const d = _billingData;
    const period = d.period;
    const dateLabel = period === 'monthly' ? 'Month' : period === 'weekly' ? 'Week Start' : 'Date';
    const excl = d.exclude_under > 0 ? `Excl_under_${d.exclude_under}s` : 'All_durations';
    const headers = ['Client Name', dateLabel, 'Total Calls', 'Total Duration Seconds', 'Total Bill Duration Seconds', 'Total Bill Minutes'];
    const lines = [headers.map(h => '"' + h + '"').join(',')];
    d.rows.forEach(r => {
        lines.push([
            '"' + (r.client_name || '').replace(/"/g, '""') + '"',
            '"' + (r.call_date || '') + '"',
            r.total_calls || 0,
            r.total_duration_seconds || 0,
            r.total_bill_duration_seconds || 0,
            r.total_bill_minutes || 0,
        ].join(','));
    });
    const t = d.totals || {};
    lines.push(['"TOTAL"', '""', t.total_calls || 0, t.total_duration_seconds || 0, t.total_bill_duration_seconds || 0, t.total_bill_minutes || 0].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BillingReport_' + d.date_from + '_to_' + d.date_to + '_' + period + '_' + excl + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}
```

### Excel Download (uses ExcelJS CDN)

```javascript
// ── Excel with colors using ExcelJS ──
// Requires: <script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js" async></script>
function downloadBillingExcel() {
    if (!_billingData || !_billingData.rows || !_billingData.rows.length) {
        alert('No billing data to download. Please load the report first.');
        return;
    }
    if (typeof ExcelJS === 'undefined') {
        alert('Excel library not loaded yet. Please wait a moment and try again.');
        return;
    }
    const d = _billingData;
    const period = d.period;
    const dateLabel = period === 'monthly' ? 'Month' : period === 'weekly' ? 'Week Start' : 'Date';
    const excl = d.exclude_under > 0 ? `Excl_under_${d.exclude_under}s` : 'All_durations';

    // Client color palettes — argb format for ExcelJS
    const XL_PALETTES = [
        { fg: 'FF4A7FA5', bg: 'FFF0F6FA' },  // steel blue
        { fg: 'FF4A9E7A', bg: 'FFF0FAF5' },  // sage green
        { fg: 'FFC49A4A', bg: 'FFFDF6EC' },  // warm amber
        { fg: 'FF888888', bg: 'FFF5F5F5' },  // slate gray
        { fg: 'FF7AAFC8', bg: 'FFF0F7FB' },  // sky blue
        { fg: 'FF9B7EC8', bg: 'FFF7F3FC' },  // soft purple
        { fg: 'FF5BA3B8', bg: 'FFF0F8FA' },  // teal
        { fg: 'FFC0504A', bg: 'FFFDF0EF' },  // muted red
    ];
    const clientList = [...new Set(d.rows.map(r => r.client_name))];
    const clientXlMap = {};
    clientList.forEach((c, i) => { clientXlMap[c] = XL_PALETTES[i % XL_PALETTES.length]; });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Verbalyze';
    const ws = wb.addWorksheet('Billing Report');

    ws.columns = [
        { header: 'Client Name',                  key: 'client', width: 26 },
        { header: dateLabel,                       key: 'date',   width: 14 },
        { header: 'Total Calls',                   key: 'calls',  width: 14 },
        { header: 'Total Duration (secs)',          key: 'dur',    width: 22 },
        { header: 'Total Bill Duration (secs)',     key: 'bdur',   width: 26 },
        { header: 'Total Bill Minutes',             key: 'bmin',   width: 20 },
    ];

    // Style header row
    ws.getRow(1).eachCell(cell => {
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border    = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
    });
    ws.getRow(1).height = 22;

    // Add data rows with colors
    d.rows.forEach((r, i) => {
        const pal     = clientXlMap[r.client_name] || XL_PALETTES[0];
        const isFirst = (i === 0 || d.rows[i - 1].client_name !== r.client_name);
        const row = ws.addRow([
            r.client_name || '',
            r.call_date || '',
            r.total_calls || 0,
            r.total_duration_seconds || 0,
            r.total_bill_duration_seconds || 0,
            r.total_bill_minutes || 0,
        ]);
        row.height = 18;
        row.eachCell((cell, colNum) => {
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.bg } };
            cell.alignment = { horizontal: colNum >= 3 ? 'right' : 'left', vertical: 'middle' };
            if (isFirst) cell.border = { top: { style: 'thin', color: { argb: pal.fg } } };
            if (colNum === 1)      cell.font = { bold: isFirst, color: { argb: pal.fg }, size: 10 };
            else if (colNum === 5) cell.font = { bold: false,   color: { argb: pal.fg }, size: 10 };
            else if (colNum === 6) cell.font = { bold: true,    color: { argb: 'FF15803D' }, size: 11 };
            else                   cell.font = { color: { argb: 'FF333333' }, size: 10 };
        });
    });

    // Totals row
    const t = d.totals || {};
    const totalRow = ws.addRow(['TOTAL', '', t.total_calls || 0, t.total_duration_seconds || 0, t.total_bill_duration_seconds || 0, t.total_bill_minutes || 0]);
    totalRow.height = 22;
    totalRow.eachCell((cell, colNum) => {
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBEA' } };
        cell.border    = { top: { style: 'medium', color: { argb: 'FF333333' } } };
        cell.alignment = { horizontal: colNum >= 3 ? 'right' : 'left', vertical: 'middle' };
        if (colNum === 6)      cell.font = { bold: true, color: { argb: 'FF15803D' }, size: 13 };
        else if (colNum === 5) cell.font = { bold: true, color: { argb: 'FF4A7FA5' }, size: 11 };
        else                   cell.font = { bold: true, color: { argb: 'FF111111' }, size: 11 };
    });

    // Download
    wb.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'BillingReport_' + d.date_from + '_to_' + d.date_to + '_' + period + '_' + excl + '.xlsx';
        a.click();
        URL.revokeObjectURL(url);
    });
}
```

### ExcelJS CDN Script Tag (at bottom of `<body>`)

```html
<script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js" async></script>
```

---

## 4. Quick Reference

### Billing Logic
| Call Duration | Billed As |
|---|---|
| 1–60 seconds | 1 minute |
| 61–120 seconds | 2 minutes |
| 121–180 seconds | 3 minutes |
| N seconds | `CEIL(N / 60)` minutes |

### What's Counted
- ✅ Answered calls only (`fact_answered_calls`)
- ✅ `webhook_status = 'sent'` only
- ✅ Valid numeric `call_duration` only
- ❌ Unanswered calls excluded
- ❌ Calls without webhook delivery excluded

### API Call Example
```
GET /api/billing-report?period=daily&date_from=2026-06-01&date_to=2026-06-10&exclude_under=15
```

### Response Columns
| Column | Description |
|---|---|
| `total_calls` | Count of distinct answered calls with webhook sent |
| `total_duration_seconds` | Raw sum of actual call durations |
| `total_bill_duration_seconds` | Each call rounded up to nearest 60s, summed |
| `total_bill_minutes` | Each call rounded up to nearest minute, summed ← **key billing number** |
