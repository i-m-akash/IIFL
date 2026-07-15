import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    BarChart3,
    Calendar,
    RefreshCw,
    Download,
    Phone,
    Clock,
    Timer,
    AlertCircle,
    ChevronDown,
    ArrowLeft,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly'
type ExcludeUnder = 0 | 5 | 10 | 15

type BillingRow = {
    client_name: string
    agent_id: string
    call_date: string
    total_calls: number
    total_duration_seconds: number
    total_bill_duration_seconds: number
    total_bill_minutes: number
}

type BillingTotals = {
    total_calls: number
    total_duration_seconds: number
    total_bill_duration_seconds: number
    total_bill_minutes: number
}

type BillingResponse = {
    success: true
    date_from: string
    date_to: string
    period: Period
    exclude_under: ExcludeUnder
    client?: string
    agent_id?: string
    rows: BillingRow[]
    totals: BillingTotals
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayIST(): string {
    // IST = UTC+5:30
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const ist = new Date(now.getTime() + istOffset)
    return ist.toISOString().slice(0, 10)
}

function getFirstOfMonthIST(): string {
    return getTodayIST().slice(0, 7) + '-01'
}

function fmtSecs(s: number): string {
    return s.toLocaleString()
}

function fmtNum(n: number): string {
    return n.toLocaleString()
}

function dateLabel(period: Period): string {
    if (period === 'monthly') return 'Month'
    if (period === 'weekly') return 'Week Start'
    return 'Date'
}

// Distinct client color palettes
const CLIENT_COLORS = [
    { text: '#4a7fa5', bg: 'rgba(74,127,165,0.07)', border: 'rgba(74,127,165,0.20)' },
    { text: '#4a9e7a', bg: 'rgba(74,158,122,0.07)', border: 'rgba(74,158,122,0.20)' },
    { text: '#c49a4a', bg: 'rgba(196,154,74,0.07)', border: 'rgba(196,154,74,0.20)' },
    { text: '#7e62c8', bg: 'rgba(126,98,200,0.07)', border: 'rgba(126,98,200,0.20)' },
    { text: '#5ba3b8', bg: 'rgba(91,163,184,0.07)', border: 'rgba(91,163,184,0.20)' },
    { text: '#c0504a', bg: 'rgba(192,80,74,0.07)', border: 'rgba(192,80,74,0.20)' },
    { text: '#888888', bg: 'rgba(100,116,139,0.07)', border: 'rgba(100,116,139,0.20)' },
    { text: '#7aafc8', bg: 'rgba(122,175,200,0.07)', border: 'rgba(122,175,200,0.20)' },
]

function clientColorMap(rows: BillingRow[]): Map<string, (typeof CLIENT_COLORS)[number]> {
    const map = new Map<string, (typeof CLIENT_COLORS)[number]>()
    const unique = [...new Set(rows.map((r) => r.client_name))]
    unique.forEach((name, i) => map.set(name, CLIENT_COLORS[i % CLIENT_COLORS.length]))
    return map
}

// CSV download
function downloadCSV(data: BillingResponse) {
    const dl = dateLabel(data.period)
    const excl = data.exclude_under > 0 ? `Excl_under_${data.exclude_under}s` : 'All_durations'
    const headers = ['Client Name', 'Agent ID', dl, 'Total Calls', 'Total Duration (secs)', 'Total Bill Duration (secs)', 'Total Bill Minutes']
    const lines = [headers.map((h) => `"${h}"`).join(',')]
    data.rows.forEach((r) => {
        lines.push([
            `"${(r.client_name || '').replace(/"/g, '""')}"`,
            `"${(r.agent_id || '').replace(/"/g, '""')}"`,
            `"${r.call_date || ''}"`,
            r.total_calls || 0,
            r.total_duration_seconds || 0,
            r.total_bill_duration_seconds || 0,
            r.total_bill_minutes || 0,
        ].join(','))
    })
    const t = data.totals
    lines.push(['"TOTAL"', '""', '""', t.total_calls, t.total_duration_seconds, t.total_bill_duration_seconds, t.total_bill_minutes].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BillingReport_${data.date_from}_to_${data.date_to}_${data.period}_${excl}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────

export default function BillingReport() {
    const navigate = useNavigate()
    const { user } = useAuth()

    const [period, setPeriod] = useState<Period>('daily')
    const [dateFrom, setDateFrom] = useState(getFirstOfMonthIST())
    const [dateTo, setDateTo] = useState(getTodayIST())
    const [excludeUnder, setExcludeUnder] = useState<ExcludeUnder>(0)
    const [clientFilter, setClientFilter] = useState('')
    const [agentIdFilter, setAgentIdFilter] = useState('')

    const [data, setData] = useState<BillingResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const abortRef = useRef<AbortController | null>(null)

    const currentMonth = useMemo(() => new Date().toLocaleString('default', { month: 'long', year: 'numeric' }), [])

    // ── Fetch ──────────────────────────────────────────────────────────────────

    const loadReport = useCallback(async (opts?: { resetDates?: boolean }) => {
        if (opts?.resetDates) {
            const today = getTodayIST()
            setDateFrom(today)
            setDateTo(today)
        }

        abortRef.current?.abort()
        abortRef.current = new AbortController()

        setLoading(true)
        setError(null)

        try {
            const params = new URLSearchParams({
                period,
                exclude_under: String(excludeUnder),
                ...(dateFrom ? { date_from: dateFrom } : {}),
                ...(dateTo ? { date_to: dateTo } : {}),
                ...(clientFilter.trim() ? { client: clientFilter.trim() } : {}),
                ...(agentIdFilter.trim() ? { agent_id: agentIdFilter.trim() } : {}),
            })
            if (opts?.resetDates) {
                const today = getTodayIST()
                params.set('date_from', today)
                params.set('date_to', today)
            }

            const res = await apiFetch(`/api/billing/report?${params.toString()}`)
            if (res.status === 403) {
                setError('Admin access required to view billing reports.')
                return
            }
            if (res.status === 422) {
                const json = (await res.json().catch(() => null)) as { error?: string } | null
                setError(json?.error ?? 'Billing table not configured for this workspace.')
                return
            }
            if (!res.ok) {
                const text = await res.text().catch(() => 'Unknown error')
                setError(`Failed to load: ${text}`)
                return
            }
            const json = (await res.json()) as BillingResponse | { success: false; error: string }
            if (!json.success) {
                setError((json as { success: false; error: string }).error || 'Failed to load billing report.')
                return
            }
            setData(json as BillingResponse)
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError('Failed to load billing report. Please try again.')
            }
        } finally {
            setLoading(false)
        }
    }, [period, excludeUnder, dateFrom, dateTo, clientFilter, agentIdFilter])

    // Load on mount
    useEffect(() => {
        void loadReport()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Summary stat cards ────────────────────────────────────────────────────

    const summaryCards = data
        ? [
            { id: 'total-calls', label: 'Total Calls', value: fmtNum(data.totals.total_calls), icon: Phone, color: 'bg-sky-50 text-sky-600' },
            { id: 'total-dur', label: 'Total Duration (s)', value: fmtSecs(data.totals.total_duration_seconds), icon: Clock, color: 'bg-slate-50 text-slate-600' },
            { id: 'bill-dur', label: 'Bill Duration (s)', value: fmtSecs(data.totals.total_bill_duration_seconds), icon: Timer, color: 'bg-violet-50 text-violet-600' },
            { id: 'bill-minutes', label: 'Total Bill Minutes', value: fmtNum(data.totals.total_bill_minutes), icon: BarChart3, color: 'bg-emerald-50 text-emerald-700' },
        ]
        : []

    const colorMap = data ? clientColorMap(data.rows) : new Map()

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Go back"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <BarChart3 className="h-5 w-5" />
                        </span>
                        <div>
                            <h1 className="text-lg font-semibold text-slate-900">Billing Report</h1>
                            <p className="flex items-center gap-1.5 text-sm text-slate-500">
                                <Calendar className="h-3.5 w-3.5" />
                                {currentMonth} · {user?.adminName ?? 'Workspace'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    {/* Period */}
                    <div className="relative">
                        <select
                            id="billing-period-select"
                            value={period}
                            onChange={(e) => setPeriod(e.target.value as Period)}
                            className="h-8 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-7 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                    </div>

                    {/* Date from */}
                    <input
                        id="billing-date-from"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <span className="text-xs text-slate-400">to</span>
                    <input
                        id="billing-date-to"
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />

                    {/* Exclude short calls */}
                    <div className="relative">
                        <select
                            id="billing-exclude-select"
                            value={excludeUnder}
                            onChange={(e) => setExcludeUnder(Number(e.target.value) as ExcludeUnder)}
                            className="h-8 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-7 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <option value={0}>All durations</option>
                            <option value={5}>Exclude &lt; 5s</option>
                            <option value={10}>Exclude &lt; 10s</option>
                            <option value={15}>Exclude &lt; 15s</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                    </div>

                    {/* Client filter */}
                    <input
                        id="billing-client-filter"
                        type="search"
                        value={clientFilter}
                        onChange={(e) => setClientFilter(e.target.value)}
                        placeholder="Client"
                        className="h-8 w-36 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />

                    {/* Agent ID filter */}
                    <input
                        id="billing-agent-id-filter"
                        type="search"
                        value={agentIdFilter}
                        onChange={(e) => setAgentIdFilter(e.target.value)}
                        placeholder="Agent ID"
                        className="h-8 w-36 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />

                    {/* Apply */}
                    <button
                        id="billing-apply-btn"
                        type="button"
                        onClick={() => void loadReport()}
                        disabled={loading}
                        className="h-8 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
                    >
                        Apply
                    </button>

                    {/* Refresh (reset to today) */}
                    <button
                        id="billing-refresh-btn"
                        type="button"
                        title="Refresh — reset to today"
                        onClick={() => void loadReport({ resetDates: true })}
                        disabled={loading}
                        className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 disabled:opacity-50',
                            loading && 'animate-spin'
                        )}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* CSV download */}
                    {data && data.rows.length > 0 && (
                        <button
                            id="billing-download-csv-btn"
                            type="button"
                            onClick={() => downloadCSV(data)}
                            className="flex h-8 items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-orange-600 transition-colors hover:bg-orange-100"
                        >
                            <Download className="h-3 w-3" />
                            CSV
                        </button>
                    )}
                </div>
            </div>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="p-6">
                    {/* Summary stat cards */}
                    {data && (
                        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {summaryCards.map((card) => {
                                const Icon = card.icon
                                return (
                                    <div
                                        key={card.id}
                                        id={`billing-stat-${card.id}`}
                                        className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                                    >
                                        <span className={cn('mb-3 flex h-8 w-8 items-center justify-center rounded-lg', card.color)}>
                                            <Icon className="h-4 w-4" />
                                        </span>
                                        <p className="text-xl font-bold tabular-nums text-slate-900">{card.value}</p>
                                        <p className="mt-0.5 text-xs text-slate-500">{card.label}</p>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Loading billing data…
                        </div>
                    )}

                    {/* Error */}
                    {!loading && error && (
                        <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-700">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Empty */}
                    {!loading && !error && data && data.rows.length === 0 && (
                        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-center">
                            <BarChart3 className="h-10 w-10 text-slate-300" />
                            <p className="font-semibold text-slate-700">No billing data for this period</p>
                            <p className="text-sm text-slate-400">No answered calls with webhook sent found.</p>
                        </div>
                    )}

                    {/* Data table */}
                    {!loading && !error && data && data.rows.length > 0 && (
                        <div>
                            {/* Metadata row */}
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>{data.rows.length} row(s) · {data.date_from} → {data.date_to} · {data.period}</span>
                                {data.exclude_under > 0 ? (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                                        Excluding &lt;{data.exclude_under}s calls
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Including all durations</span>
                                )}
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm" id="billing-table-wrap">
                                <table className="w-full text-sm" id="billing-invoices-table">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-900 text-white">
                                            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Client Name</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">{dateLabel(data.period)}</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Total Calls</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Duration (secs)</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Bill Duration (secs)</th>
                                            <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">Bill Minutes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.rows.map((row, idx) => {
                                            const pal = colorMap.get(row.client_name) ?? CLIENT_COLORS[0]
                                            const isNewClient = idx === 0 || data.rows[idx - 1].client_name !== row.client_name
                                            return (
                                                <tr
                                                    key={`${row.client_name}-${row.call_date}-${idx}`}
                                                    style={{ backgroundColor: pal.bg, borderTop: isNewClient ? `2px solid ${pal.border}` : undefined }}
                                                    className="transition-colors"
                                                >
                                                    <td
                                                        className="whitespace-nowrap px-4 py-2.5 text-xs"
                                                        style={{
                                                            color: pal.text,
                                                            fontWeight: isNewClient ? 700 : 400,
                                                            opacity: isNewClient ? 1 : 0.75,
                                                        }}
                                                    >
                                                        {row.client_name}
                                                    </td>
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600">{row.call_date || '—'}</td>
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-900">{fmtNum(row.total_calls)}</td>
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-slate-600">{fmtSecs(row.total_duration_seconds)}</td>
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold" style={{ color: pal.text }}>{fmtSecs(row.total_bill_duration_seconds)}</td>
                                                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-bold text-emerald-700">{fmtNum(row.total_bill_minutes)}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-slate-300 bg-slate-100">
                                            <td colSpan={2} className="px-4 py-3 text-xs font-bold text-slate-800">TOTAL</td>
                                            <td className="px-4 py-3 text-right text-xs font-bold text-slate-800">{fmtNum(data.totals.total_calls)}</td>
                                            <td className="px-4 py-3 text-right text-xs font-bold text-slate-800">{fmtSecs(data.totals.total_duration_seconds)}</td>
                                            <td className="px-4 py-3 text-right text-xs font-bold text-[#4a7fa5]">{fmtSecs(data.totals.total_bill_duration_seconds)}</td>
                                            <td className="px-4 py-3 text-right text-sm font-extrabold text-emerald-700">{fmtNum(data.totals.total_bill_minutes)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            <p className="mt-2 text-center text-[11px] text-slate-400">
                                Answered calls only · webhook_status = sent · Billing rounded up to nearest minute
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
