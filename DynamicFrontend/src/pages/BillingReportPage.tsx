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
    Search,
    Check,
} from 'lucide-react'
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
    rows: BillingRow[]
    totals: BillingTotals
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayIST(): string {
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

// ── SearchableSelect component ────────────────────────────────────────────────

type SearchableSelectProps = {
    id: string
    value: string
    onChange: (val: string) => void
    options: string[]
    placeholder: string
    allLabel: string
    className?: string
}

function SearchableSelect({ id, value, onChange, options, placeholder, allLabel, className }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [search, setSearch] = useState('')
    const containerRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
                setSearch('')
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false)
                setSearch('')
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    // Focus search when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchRef.current?.focus(), 50)
        }
    }, [isOpen])

    const filtered = useMemo(() => {
        if (!search.trim()) return options
        const q = search.toLowerCase()
        return options.filter((o) => o.toLowerCase().includes(q))
    }, [options, search])

    const displayLabel = value === '' ? allLabel : value

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            {/* Trigger */}
            <button
                id={id}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => setIsOpen((prev) => !prev)}
                className={cn(
                    'flex h-10 min-w-[140px] max-w-[200px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white pl-3 pr-2.5 text-sm font-medium shadow-sm transition-all',
                    'hover:border-slate-300 hover:shadow',
                    isOpen
                        ? 'border-blue-300 ring-2 ring-blue-100 text-slate-900'
                        : value !== ''
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'text-slate-600'
                )}
            >
                <span className="truncate">{displayLabel}</span>
                <ChevronDown
                    className={cn(
                        'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                        isOpen && 'rotate-180'
                    )}
                />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div
                    role="listbox"
                    className={cn(
                        'absolute left-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl',
                        'animate-in fade-in-0 zoom-in-95 duration-150'
                    )}
                    style={{
                        animation: 'searchSelectOpen 0.15s ease-out forwards',
                    }}
                >
                    {/* Search box */}
                    <div className="border-b border-slate-100 p-2">
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <input
                                ref={searchRef}
                                type="text"
                                placeholder={placeholder}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none"
                            />
                        </div>
                    </div>

                    {/* Options list */}
                    <div className="max-h-52 overflow-y-auto p-1">
                        {/* "All" option */}
                        <button
                            type="button"
                            role="option"
                            aria-selected={value === ''}
                            onClick={() => {
                                onChange('')
                                setIsOpen(false)
                                setSearch('')
                            }}
                            className={cn(
                                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                                value === ''
                                    ? 'bg-blue-50 font-semibold text-blue-700'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                            )}
                        >
                            <span>{allLabel}</span>
                            {value === '' && <Check className="h-3.5 w-3.5 text-blue-600" />}
                        </button>

                        {/* Divider */}
                        {filtered.length > 0 && <div className="my-1 border-t border-slate-100" />}

                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-slate-400">
                                No results found
                            </div>
                        ) : (
                            filtered.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    role="option"
                                    aria-selected={value === option}
                                    onClick={() => {
                                        onChange(option)
                                        setIsOpen(false)
                                        setSearch('')
                                    }}
                                    className={cn(
                                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                                        value === option
                                            ? 'bg-blue-50 font-semibold text-blue-700'
                                            : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                                    )}
                                >
                                    <span className="truncate">{option || '(empty)'}</span>
                                    {value === option && <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BillingReportPage() {
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

    // Options for dropdowns — derived from an "all data" fetch (wide date range)
    const [allClients, setAllClients] = useState<string[]>([])
    const [allAgents, setAllAgents] = useState<string[]>([])

    const abortRef = useRef<AbortController | null>(null)
    const optionsAbortRef = useRef<AbortController | null>(null)

    const currentMonth = useMemo(() => new Date().toLocaleString('default', { month: 'long', year: 'numeric' }), [])

    // ── Fetch dropdown options (wide range, no filters) ────────────────────────

    const loadOptions = useCallback(async () => {
        optionsAbortRef.current?.abort()
        optionsAbortRef.current = new AbortController()
        try {
            // Fetch last 2 years of data to get all distinct clients/agents
            const params = new URLSearchParams({
                period: 'daily',
                exclude_under: '0',
                date_from: '2020-01-01',
                date_to: getTodayIST(),
            })
            const res = await apiFetch(`/api/billing/report?${params.toString()}`)
            if (!res.ok) return
            const json = (await res.json()) as BillingResponse | { success: false }
            if (!json.success) return
            const rows = (json as BillingResponse).rows
            const clients = [...new Set(rows.map((r) => r.client_name).filter(Boolean))].sort()
            const agents = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))].sort()
            setAllClients(clients)
            setAllAgents(agents)
        } catch {
            // silently ignore — dropdowns will just be empty
        }
    }, [])

    // ── Fetch report ──────────────────────────────────────────────────────────

    const loadReport = useCallback(async (opts?: { resetDates?: boolean }) => {
        if (opts?.resetDates) {
            const today = getTodayIST()
            setDateFrom(today)
            setDateTo(today)
            setClientFilter('')
            setAgentIdFilter('')
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
                ...(clientFilter ? { client: clientFilter } : {}),
                ...(agentIdFilter ? { agent_id: agentIdFilter } : {}),
            })
            if (opts?.resetDates) {
                const today = getTodayIST()
                params.set('date_from', today)
                params.set('date_to', today)
                params.delete('client')
                params.delete('agent_id')
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
            const reportData = json as BillingResponse
            setData(reportData)

            // Merge newly seen clients/agents into the dropdown options
            setAllClients((prev) => {
                const merged = [...new Set([...prev, ...reportData.rows.map((r) => r.client_name).filter(Boolean)])].sort()
                return merged
            })
            setAllAgents((prev) => {
                const merged = [...new Set([...prev, ...reportData.rows.map((r) => r.agent_id).filter(Boolean)])].sort()
                return merged
            })
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError('Failed to load billing report. Please try again.')
            }
        } finally {
            setLoading(false)
        }
    }, [period, excludeUnder, dateFrom, dateTo, clientFilter, agentIdFilter])

    // Load when page mounts
    useEffect(() => {
        void loadOptions()
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
        <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
            <style>{`
                @keyframes searchSelectOpen {
                    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0)   scale(1);    }
                }
            `}</style>

            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                            <BarChart3 className="h-6 w-6" />
                        </span>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Billing Report</h1>
                            <p className="flex items-center gap-1.5 text-sm text-slate-500">
                                <Calendar className="h-4 w-4" />
                                {currentMonth} · {user?.adminName ?? 'Workspace'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
                {/* ── Filter bar ── */}
                <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Period */}
                        <div className="relative">
                            <select
                                id="billing-period-select"
                                value={period}
                                onChange={(e) => setPeriod(e.target.value as Period)}
                                className="h-10 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        </div>

                        {/* Client searchable dropdown */}
                        <SearchableSelect
                            id="billing-client-select"
                            value={clientFilter}
                            onChange={setClientFilter}
                            options={allClients}
                            placeholder="Search clients…"
                            allLabel="All Clients"
                        />

                        {/* Agent searchable dropdown */}
                        <SearchableSelect
                            id="billing-agent-select"
                            value={agentIdFilter}
                            onChange={setAgentIdFilter}
                            options={allAgents}
                            placeholder="Search agents…"
                            allLabel="All Agents"
                        />

                        {/* Date from */}
                        <input
                            id="billing-date-from"
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <span className="text-sm font-medium text-slate-400">to</span>
                        <input
                            id="billing-date-to"
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />

                        {/* Exclude short calls */}
                        <div className="relative">
                            <select
                                id="billing-exclude-select"
                                value={excludeUnder}
                                onChange={(e) => setExcludeUnder(Number(e.target.value) as ExcludeUnder)}
                                className="h-10 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                <option value={0}>All durations</option>
                                <option value={5}>Exclude &lt; 5s</option>
                                <option value={10}>Exclude &lt; 10s</option>
                                <option value={15}>Exclude &lt; 15s</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        </div>

                        {/* Apply */}
                        <button
                            id="billing-apply-btn"
                            type="button"
                            onClick={() => void loadReport()}
                            disabled={loading}
                            className="h-10 rounded-lg border border-blue-200 bg-blue-50 px-5 text-sm font-semibold text-blue-600 shadow-sm transition-colors hover:bg-blue-100 disabled:opacity-50"
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
                                'flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 disabled:opacity-50',
                                loading && 'animate-spin'
                            )}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* CSV download */}
                        {data && data.rows.length > 0 && (
                            <button
                                id="billing-download-csv-btn"
                                type="button"
                                onClick={() => downloadCSV(data)}
                                className="flex h-10 items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-semibold text-orange-600 shadow-sm transition-colors hover:bg-orange-100"
                            >
                                <Download className="h-4 w-4" />
                                CSV
                            </button>
                        )}
                    </div>
                </div>

                <div className="min-h-[400px]">
                    {/* Summary stat cards */}
                    {data && (
                        <div className="grid grid-cols-2 gap-4 p-6 pb-2 sm:grid-cols-4">
                            {summaryCards.map((card) => {
                                const Icon = card.icon
                                return (
                                    <div
                                        key={card.id}
                                        id={`billing-stat-${card.id}`}
                                        className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5"
                                    >
                                        <span className={cn('mb-4 flex h-10 w-10 items-center justify-center rounded-xl', card.color)}>
                                            <Icon className="h-5 w-5" />
                                        </span>
                                        <p className="text-3xl font-bold tabular-nums text-slate-900">{card.value}</p>
                                        <p className="mt-1 text-sm text-slate-500">{card.label}</p>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="flex min-h-[300px] items-center justify-center text-slate-500">
                            <RefreshCw className="mr-3 h-6 w-6 animate-spin" />
                            <span className="text-lg">Loading billing data…</span>
                        </div>
                    )}

                    {/* Error */}
                    {!loading && error && (
                        <div className="m-6 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-5 text-red-700">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                            <span className="text-base">{error}</span>
                        </div>
                    )}

                    {/* Empty */}
                    {!loading && !error && data && data.rows.length === 0 && (
                        <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-8 text-center">
                            <BarChart3 className="h-14 w-14 text-slate-300" />
                            <p className="text-lg font-semibold text-slate-700">No billing data for this period</p>
                            <p className="text-slate-500">No answered calls with webhook sent found.</p>
                        </div>
                    )}

                    {/* Data table */}
                    {!loading && !error && data && data.rows.length > 0 && (
                        <div className="px-6 pb-6 pt-4">
                            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                <span>{data.rows.length} row(s) · {data.date_from} → {data.date_to} · {data.period}</span>
                                {clientFilter && (
                                    <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700">
                                        Client: {clientFilter}
                                    </span>
                                )}
                                {agentIdFilter && (
                                    <span className="rounded-full bg-indigo-100 px-3 py-1 font-semibold text-indigo-700">
                                        Agent: {agentIdFilter}
                                    </span>
                                )}
                                {data.exclude_under > 0 ? (
                                    <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700">
                                        Excluding &lt;{data.exclude_under}s calls
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">Including all durations</span>
                                )}
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-slate-200">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-900 text-white">
                                            <th className="whitespace-nowrap px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider">Client Name</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider">Agent ID</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider">{dateLabel(data.period)}</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider">Total Calls</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider">Duration (secs)</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider">Bill Duration (secs)</th>
                                            <th className="whitespace-nowrap px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider">Bill Minutes</th>
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
                                                    className="transition-colors hover:opacity-90"
                                                >
                                                    <td
                                                        className="whitespace-nowrap px-5 py-4 text-sm"
                                                        style={{
                                                            color: pal.text,
                                                            fontWeight: isNewClient ? 700 : 500,
                                                            opacity: isNewClient ? 1 : 0.8,
                                                        }}
                                                    >
                                                        {row.client_name}
                                                    </td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500 font-medium">{row.agent_id || '—'}</td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{row.call_date || '—'}</td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold text-slate-900">{fmtNum(row.total_calls)}</td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm text-slate-600">{fmtSecs(row.total_duration_seconds)}</td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold" style={{ color: pal.text }}>{fmtSecs(row.total_bill_duration_seconds)}</td>
                                                    <td className="whitespace-nowrap px-5 py-4 text-right text-base font-bold text-emerald-700">{fmtNum(row.total_bill_minutes)}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-slate-300 bg-slate-100">
                                            <td colSpan={3} className="px-5 py-4 text-sm font-bold text-slate-800">TOTAL</td>
                                            <td className="px-5 py-4 text-right text-sm font-bold text-slate-800">{fmtNum(data.totals.total_calls)}</td>
                                            <td className="px-5 py-4 text-right text-sm font-bold text-slate-800">{fmtSecs(data.totals.total_duration_seconds)}</td>
                                            <td className="px-5 py-4 text-right text-sm font-bold text-[#4a7fa5]">{fmtSecs(data.totals.total_bill_duration_seconds)}</td>
                                            <td className="px-5 py-4 text-right text-base font-extrabold text-emerald-700">{fmtNum(data.totals.total_bill_minutes)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            <p className="mt-4 text-center text-xs text-slate-400">
                                Answered calls only · webhook_status = sent · Billing rounded up to nearest minute
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    )
}
