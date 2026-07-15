import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { apiErrorFromResponse, apiFetch, getUserErrorMessage } from '../../lib/api';
import { useParams } from 'react-router-dom';
import { Loader2, Play, Pause, ChevronLeft, ChevronRight, Search, Download, MessageSquare, Send, X } from 'lucide-react';
import { columnsFromData, type ColDef } from '../../lib/columnsFromData';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { brandSearchInputClass } from '@/lib/brandCss';
import { rowMatchesCampaignSearch } from '@/lib/campaignSearch';
import { cn } from '@/lib/utils';
import Papa from 'papaparse';


type AgentRef = { agent_id?: string; id?: string; name?: string } | null;

type CallAnalyticsProps = {
  agent: AgentRef;
  batchId?: string;
  batchIdRequired?: boolean;
  externalSearch?: string;
  hideSearchBar?: boolean;
  onBack: () => void;
  backLabel?: string;
  subtitle?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  rows?: Record<string, string>[]
  chart?: {
    type: 'bar' | 'line' | 'pie'
    title: string
    labels: string[]
    values: number[]
  }
}

type AssistantResponse = Omit<ChatMessage, 'role'>

async function askAnalyticsChatApi(
  agentId: string,
  payload: {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  },
) {
  const response = await apiFetch(`/api/dashboard/analytics-chat/${agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(response, 'Unable to answer that analytics question. Please try again.')
  }

  const result = (await response.json().catch(() => null)) as
    | {
        success?: boolean
        data?: AssistantResponse
        error?: string
      }
    | null

  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'Unable to answer that analytics question. Please try again.')
  }

  return result.data
}

function MiniChart({ chart }: { chart: NonNullable<ChatMessage['chart']> }) {
  const max = Math.max(...chart.values, 1)
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-sm font-semibold text-slate-900">{chart.title}</div>
      <div className="mt-3 space-y-2">
        {chart.labels.map((label, index) => (
          <div key={`${label}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <span className="truncate">{label}</span>
              <span className="font-semibold text-slate-900">{chart.values[index] ?? 0}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-slate-900 transition-all"
                style={{ width: `${Math.max(8, Math.round(((chart.values[index] ?? 0) / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsChatDrawer({
  open,
  onClose,
  agentId,
  agentName,
}: {
  open: boolean
  onClose: () => void
  agentId: string
  agentName?: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const suggestions = [
    'How many calls happened overall?',
    'Show sentiment breakdown as a chart',
    'What is the average call duration?',
    'Show the longest calls',
    'Summarize this agent performance',
  ]

  const send = async (messageText: string) => {
    const trimmed = messageText.trim()
    if (!trimmed || sending) return
    setMessages((current) => [...current, { role: 'user', content: trimmed }])
    setInput('')
    setSending(true)
    try {
      const history = messages
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }))
      const answer = await askAnalyticsChatApi(agentId, {
        message: trimmed,
        history,
      })
      setMessages((current) => [...current, { role: 'assistant', ...answer }])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: getUserErrorMessage(error, 'Unable to answer that analytics question. Please try again.'),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageSquare className="h-4 w-4" />
            Ask AI
          </div>
          <div className="mt-1 text-xs text-slate-500">{agentName ? `Analytics assistant for ${agentName}` : 'Analytics assistant'}</div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => void send(item)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
              disabled={sending}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
            Ask about totals, duration, sentiment, daily trends, longest calls, or a performance summary across this agent&apos;s full analytics table.
          </div>
        ) : null}

        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={cn(
                'max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                message.role === 'user' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-800',
              )}
            >
              <p className="leading-6">{message.content}</p>
              {message.chart ? <MiniChart chart={message.chart} /> : null}
              {message.rows?.length ? (
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        {Object.keys(message.rows[0] ?? {}).map((key) => (
                          <th key={key} className="px-3 py-2 font-semibold text-slate-600">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {message.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-slate-100">
                          {Object.values(row).map((value, valueIndex) => (
                            <td key={valueIndex} className="px-3 py-2 text-slate-700">
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-4">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(input)
              }
            }}
            rows={2}
            placeholder="Ask about this agent’s full analytics data…"
            className="min-h-[72px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <Button type="button" className="h-11 gap-2" onClick={() => void send(input)} disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

const CallAnalytics = ({
  agent,
  batchId,
  batchIdRequired = false,
  externalSearch,
  hideSearchBar = false,
  onBack,
  backLabel = 'Back to Agents',
  subtitle,
}: CallAnalyticsProps) => {
  const { agentId: agentIdParam } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<Record<string, string>[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<{ row: number | null; column: string | null }>({
    row: null,
    column: null,
  });
  const [modalContent, setModalContent] = useState('');
  const [agentId, setAgentId] = useState('');
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [showChatbot, setShowChatbot] = useState(false);
  const [batchSearchRows, setBatchSearchRows] = useState<Record<string, string>[] | null>(null);

  const isCampaignScope = Boolean(batchIdRequired && batchId?.trim());
  const effectiveSearch = externalSearch ?? search;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (externalSearch === undefined && search !== searchInput) {
        setSearch(searchInput)
        setPage(1)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [searchInput, search, externalSearch])

  useEffect(() => {
    if (externalSearch === undefined) return
    setSearch(externalSearch)
    setPage(1)
  }, [externalSearch])

  // Dynamic column styles based on column ID
  const getColumnStyle = (columnId: string) => {
    if (columnId === 'CallRecording') return 'min-w-[100px] text-center';
    if (columnId === 'Date' || columnId === 'Time') return 'min-w-[120px] whitespace-nowrap';
    return 'min-w-[180px] max-w-[350px] truncate';
  };

  const handlePlayPause = (recordUrl: string) => {
    const audioEl = document.getElementById('audio-player')
    if (currentlyPlaying === recordUrl) {
      setCurrentlyPlaying(null)
      if (audioEl instanceof HTMLAudioElement) audioEl.pause()
    } else {
      setCurrentlyPlaying(recordUrl)
      if (audioEl instanceof HTMLAudioElement) {
        audioEl.src = recordUrl
        void audioEl.play()
      }
    }
  }

  const handleExpand = (rowIdx: number, columnId: string, content: string) => {
    setExpandedCell({ row: rowIdx, column: columnId });
    setModalContent(content);
  };

  const renderCell = (columnId: string, value: string | undefined, rowIdx: number) => {
    if (!value || value === 'Unknown' || value === 'Not Captured' || value === 'Not Provided' || value === 'None' || value === 'No Summary Available' || value === 'No Transcript Available') {
      return <span className="text-muted-foreground">N/A</span>;
    }

    if (columnId.toLowerCase().includes('recording') && (value.startsWith('http') || value.startsWith('//'))) {
      return (
        <Button
          type="button"
          size="icon"
          variant={currentlyPlaying === value ? 'default' : 'secondary'}
          className={cn("h-8 w-8 rounded-full shadow-sm transition-all hover:scale-105", currentlyPlaying === value && "animate-pulse")}
          onClick={() => handlePlayPause(value)}
        >
          {currentlyPlaying === value ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      );
    }

    if (value && typeof value === 'string' && value.length > 35) {
      return (
        <Button
          type="button"
          variant="link"
          className="h-auto min-h-0 w-full justify-start truncate p-0 text-xs font-normal"
          title={value}
          onClick={() => handleExpand(rowIdx, columnId, value)}
        >
          {columnId === 'Summary' || columnId === 'Transcript' ? `View ${columnId}` : `${value.substring(0, 35)}...`}
        </Button>
      );
    }

    switch (columnId) {
      case 'LoanAmount':
      case 'PayableAmount':
        return value !== '0' ? <span className="font-medium text-emerald-600">₹{value}</span> : <span className="text-muted-foreground">₹0</span>;
      case 'CustomerSatisfaction':
        const num = parseInt(value);
        return (
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold ring-1", num >= 4 ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : num >= 3 ? 'bg-yellow-100 text-yellow-800 ring-yellow-200' : 'bg-red-100 text-red-700 ring-red-200')}>
            {value}
          </span>
        );
      case 'Sentiment':
        return (
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold ring-1", value === 'Positive' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : value === 'Neutral' ? 'bg-yellow-100 text-yellow-800 ring-yellow-200' : 'bg-red-100 text-red-700 ring-red-200')}>
            {value}
          </span>
        );
      case 'CallOutcome':
        const lower = value.toLowerCase();
        return (
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold ring-1", lower === 'successful' || lower === 'insight_shared' || lower === 'insight shared' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : lower === 'no_resolution' ? 'bg-red-100 text-red-700 ring-red-200' : 'bg-slate-100 text-slate-700 ring-slate-200')}>
            {value}
          </span>
        );
      case 'WillingToPay':
      case 'CallbackRequested':
      case 'TicketBooked':
      case 'IsMeaningfulInteraction':
        const isPositive = ['true', 'yes'].includes(value.toLowerCase());
        return (
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold ring-1", isPositive ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : 'bg-red-100 text-red-700 ring-red-200')}>
            {isPositive ? 'Yes' : 'No'}
          </span>
        );
      default:
        return value;
    }
  };

  const handleCloseModal = () => {
    setExpandedCell({ row: null, column: null });
    setModalContent("");
  };

  useEffect(() => {
    if (agent) {
      const id = agent.agent_id || agent.id || agent.name;
      if (id) {
        setAgentId(id);
      } else {
        console.error('No valid agent ID found in agent object');
        setLoading(false);
      }
    } else if (agentIdParam) {
      setAgentId(agentIdParam);
    } else {
      setLoading(false);
    }
  }, [agent, agentIdParam]);

  const fetchCallAnalytics = useCallback(
    async (isBackgroundRefresh = false) => {
      if (!agentId) return
      if (batchIdRequired && !batchId?.trim()) return
      if (isCampaignScope && effectiveSearch.trim()) return

      if (!isBackgroundRefresh) setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        })
        if (startDate) params.append('startDate', startDate)
        if (endDate) params.append('endDate', endDate)
        if (search) params.append('search', search)
        if (batchId) params.append('batchId', batchId)

        const response = await apiFetch(`/api/dashboard/callanalytics/${agentId}?${params}`)
        if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load analytics. Please refresh and try again.')
        const data = (await response.json()) as {
          pages?: Record<number, Record<string, string>[]>
          totalPages?: number
          totalCount?: number
        }
        if (data.pages?.[page]) {
          setAnalyticsData(data.pages[page])
          setTotalPages(data.totalPages ?? 1)
          setTotalCount(data.totalCount ?? 0)
        } else {
          setAnalyticsData([])
          setTotalCount(0)
          setTotalPages(1)
        }
      } catch (e) {
        if (!isBackgroundRefresh) {
          setError(getUserErrorMessage(e, 'Unable to load analytics. Please refresh and try again.'))
        }
        setAnalyticsData([])
        setTotalCount(0)
        setTotalPages(1)
      } finally {
        setLoading(false)
      }
    },
    [page, pageSize, agentId, startDate, endDate, search, batchId, batchIdRequired, isCampaignScope, effectiveSearch]
  );

  useEffect(() => {
    if (!isCampaignScope || !agentId || !batchId?.trim()) {
      setBatchSearchRows(null)
      return
    }
    if (!effectiveSearch.trim()) {
      setBatchSearchRows(null)
      return
    }

    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const collected: Record<string, string>[] = []
        let apiPage = 1
        while (apiPage <= 50) {
          const params = new URLSearchParams({
            page: String(apiPage),
            pageSize: '100',
            batchId,
          })
          if (startDate) params.append('startDate', startDate)
          if (endDate) params.append('endDate', endDate)

          const response = await apiFetch(`/api/dashboard/callanalytics/${agentId}?${params}`)
          if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to search analytics. Please try again.')
          const data = (await response.json()) as { pages?: Record<number, Record<string, string>[]> }
          const rows = data.pages?.[apiPage] ?? []
          collected.push(...rows)
          if (rows.length < 100) break
          apiPage += 1
        }

        if (!cancelled) {
          setBatchSearchRows(collected.filter((row) => rowMatchesCampaignSearch(row, effectiveSearch)))
          setPage(1)
        }
      } catch (e) {
        if (!cancelled) {
          setError(getUserErrorMessage(e, 'Unable to search analytics. Please try again.'))
          setBatchSearchRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isCampaignScope, agentId, batchId, effectiveSearch, startDate, endDate])

  const activeRows = useMemo(() => {
    if (isCampaignScope && effectiveSearch.trim() && batchSearchRows) {
      return batchSearchRows.slice((page - 1) * pageSize, page * pageSize)
    }
    return analyticsData
  }, [isCampaignScope, effectiveSearch, batchSearchRows, analyticsData, page, pageSize])

  const activeTotalCount =
    isCampaignScope && effectiveSearch.trim() && batchSearchRows ? batchSearchRows.length : totalCount
  const activeTotalPages =
    isCampaignScope && effectiveSearch.trim() && batchSearchRows
      ? Math.max(1, Math.ceil(batchSearchRows.length / pageSize))
      : totalPages

  const displayColumns = useMemo(() => columnsFromData(activeRows, []), [activeRows]);

  useEffect(() => {
    if (!agentId) return
    void fetchCallAnalytics(false)
  }, [agentId, fetchCallAnalytics])

  useEffect(() => {
    if (!agentId) return
    refreshIntervalRef.current = setInterval(() => void fetchCallAnalytics(true), 30000)
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
  }, [agentId, fetchCallAnalytics])

  const handleDownload = async () => {
    if (!agentId) return;
    setIsDownloading(true);
    try {
      const params = new URLSearchParams({
        download: 'true',
      });
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (search) params.append('search', search);
      if (batchId) params.append('batchId', batchId);

      const response = await apiFetch(`/api/dashboard/callanalytics/${agentId}?${params}`);
      if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to download analytics. Please try again.');
      const data = await response.json();

      const allAnalytics = data.pages?.[1] || [];

      if (allAnalytics.length === 0) {
        alert('No data available to download.');
        return;
      }

      const csv = Papa.unparse(allAnalytics);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CallAnalytics_${agent?.name || 'Agent'}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed', e);
      alert('Failed to download analytics. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= activeTotalPages) setPage(newPage)
  }

  const renderPaginationButtons = () => {
    const buttons: ReactNode[] = []
    const maxVisiblePages = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(activeTotalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    if (startPage > 1) {
      buttons.push(
        <Button key="first" type="button" variant="secondary" size="sm" className="h-8 min-w-8 px-2" onClick={() => goToPage(1)}>
          1
        </Button>
      );
      if (startPage > 2) {
        buttons.push(<span key="ellipsis1" className="px-1 text-muted-foreground">…</span>);
      }
    }
    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <Button
          key={i}
          type="button"
          variant={i === page ? 'default' : 'secondary'}
          size="sm"
          className="h-8 min-w-8 px-2"
          onClick={() => goToPage(i)}
        >
          {i}
        </Button>
      );
    }
    if (endPage < activeTotalPages) {
      if (endPage < activeTotalPages - 1) {
        buttons.push(<span key="ellipsis2" className="px-1 text-muted-foreground">…</span>);
      }
      buttons.push(
        <Button
          key="last"
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 min-w-8 px-2"
          onClick={() => goToPage(activeTotalPages)}
        >
          {activeTotalPages}
        </Button>
      );
    }
    return buttons;
  };

  if (batchIdRequired && !batchId?.trim()) {
    return (
      <Card className="rounded-lg border-dashed p-8 text-center shadow-none">
        <p className="text-sm font-medium text-slate-900">No batch linked to this campaign</p>
        <p className="mt-1 text-sm text-slate-500">Import leads with a batch_id or create the campaign to assign one.</p>
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Call Analytics</h2>
            <p className="text-slate-600">{subtitle ?? agent?.name ?? ''}</p>

          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              {backLabel}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="text-red-500 text-center py-8">{error}</div>
        ) : (
          <Card className="min-h-[80vh] relative">
            {loading && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-[1px] rounded-xl">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            )}
            <CardContent className="p-4 sm:p-6 pt-6">
              <div className="mb-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {!hideSearchBar ? (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search numbers or names..."
                          className={cn('w-[200px] pl-8 sm:w-[250px]', brandSearchInputClass)}
                          value={searchInput}
                          onChange={(e) => {
                            setSearchInput(e.target.value);
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        className="w-auto"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          setPage(1);
                        }}
                      />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input
                        type="date"
                        className="w-auto"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setPage(1);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => setShowChatbot(true)} className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Ask AI
                    </Button>
                    <Button onClick={handleDownload} disabled={isDownloading || loading || activeRows.length === 0} className="gap-2">
                      {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Download
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, activeTotalCount)} of {activeTotalCount} results
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => goToPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-wrap items-center gap-1">{renderPaginationButtons()}</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page === activeTotalPages || loading}
                      onClick={() => goToPage(page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border pb-2 shadow-inner">
                <Table className="w-full min-w-max border-collapse">
                  <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <TableRow className="hover:bg-transparent">
                      {displayColumns.map((column) => (
                        <TableHead
                          key={column.id}
                          className={`border-r px-4 py-3 text-left text-xs font-medium uppercase tracking-wide bg-slate-50 text-slate-600 ${getColumnStyle(column.id)}`}
                        >
                          {column.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeRows.length === 0 && !loading ? (
                      <TableRow>
                        <TableCell colSpan={Math.max(displayColumns.length, 5)} className="h-40 text-center align-middle text-muted-foreground">
                          {isCampaignScope ? 'No analytics found for this campaign batch' : 'No analytics data available for this agent'}
                        </TableCell>
                      </TableRow>
                    ) : activeRows.length === 0 && loading ? (
                      <TableRow>
                        <TableCell colSpan={Math.max(displayColumns.length, 5)} className="h-40 text-center align-middle">
                          <div className="flex items-center justify-center gap-2 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <span className="text-sm">Loading analytics…</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeRows.map((row, index) => (
                        <TableRow key={index} className="border-b">
                          {displayColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              className={`border-r px-4 py-3 text-xs align-middle text-slate-700 ${getColumnStyle(column.id)}`}
                            >
                              {renderCell(column.id, row[column.id], index)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Modal for expanded content */}
      {expandedCell.row !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="mb-4 font-semibold text-lg">{expandedCell.column}</div>
            <div className="whitespace-pre-wrap break-words text-sm" style={{ maxHeight: 400, overflowY: 'auto' }}>{modalContent}</div>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={handleCloseModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      <audio id="audio-player" style={{ display: 'none' }} />
      <AnalyticsChatDrawer
        open={showChatbot}
        onClose={() => setShowChatbot(false)}
        agentId={agentId}
        agentName={agent?.name}
      />
    </>
  );
};

export default CallAnalytics;
