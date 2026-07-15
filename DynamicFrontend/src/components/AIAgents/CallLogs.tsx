import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { apiErrorFromResponse, apiFetch } from '../../lib/api'
import { useParams } from 'react-router-dom'
import { Loader2, ChevronLeft, ChevronRight, Play, Pause, Search, Download, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { columnsFromData, type ColDef } from '../../lib/columnsFromData'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { brandSearchInputClass } from '@/lib/brandCss'
import { rowMatchesCampaignSearch } from '@/lib/campaignSearch'
import { cn } from '@/lib/utils'
import Papa from 'papaparse'



type AgentRef = { agent_id?: string; id?: string; name?: string } | null

type CallLogsProps = {
  agent: AgentRef
  batchId?: string
  batchIdRequired?: boolean
  externalSearch?: string
  hideSearchBar?: boolean
  onBack: () => void
  backLabel?: string
  subtitle?: string
}

export default function CallLogs({
  agent,
  batchId,
  batchIdRequired = false,
  externalSearch,
  hideSearchBar = false,
  onBack,
  backLabel = 'Back to Agents',
  subtitle,
}: CallLogsProps) {
  const { agentId: agentIdParam } = useParams()
  const [loading, setLoading] = useState(true)
  const [callLogs, setCallLogs] = useState<Record<string, string>[]>([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [agentId, setAgentId] = useState('')
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [batchSearchRows, setBatchSearchRows] = useState<Record<string, string>[] | null>(null)

  const isCampaignScope = Boolean(batchIdRequired && batchId?.trim())
  const effectiveSearch = externalSearch ?? search

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

  useEffect(() => {
    if (agent) {
      const id = agent.agent_id || agent.id || agent.name
      if (id) setAgentId(String(id))
      else setLoading(false)
    } else if (agentIdParam) setAgentId(agentIdParam)
    else setLoading(false)
  }, [agent, agentIdParam])

  const fetchCallLogs = useCallback(
    async (isBackgroundRefresh = false) => {
      if (!agentId) return
      if (batchIdRequired && !batchId?.trim()) return
      if (isCampaignScope && effectiveSearch.trim()) return

      if (!isBackgroundRefresh) setLoading(true)

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        })
        if (startDate) params.append('startDate', startDate)
        if (endDate) params.append('endDate', endDate)
        if (search) params.append('search', search)
        if (batchId) params.append('batchId', batchId)

        const response = await apiFetch(`/api/dashboard/calllogs/${agentId}?${params}`)
        if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load call logs. Please refresh and try again.')
        const data = (await response.json()) as {
          pages?: Record<number, Record<string, string>[]>
          totalPages?: number
          totalCount?: number
        }
        if (data.pages?.[page] && Array.isArray(data.pages[page])) {
          setCallLogs(data.pages[page])
          setTotalPages(data.totalPages ?? 1)
          setTotalCount(data.totalCount ?? 0)
        } else {
          setCallLogs([])
          setTotalCount(0)
          setTotalPages(1)
        }
      } catch (e) {
        if (!isBackgroundRefresh) console.error('Call logs fetch failed', e)
        setCallLogs([])
        setTotalCount(0)
        setTotalPages(1)
      } finally {
        setLoading(false)
      }
    },
    [page, pageSize, agentId, startDate, endDate, search, batchId, batchIdRequired, isCampaignScope, effectiveSearch]
  )

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

          const response = await apiFetch(`/api/dashboard/calllogs/${agentId}?${params}`)
          if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to search call logs. Please try again.')
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
          console.error('Campaign batch call-log search failed', e)
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
    return callLogs
  }, [isCampaignScope, effectiveSearch, batchSearchRows, callLogs, page, pageSize])

  const activeTotalCount =
    isCampaignScope && effectiveSearch.trim() && batchSearchRows ? batchSearchRows.length : totalCount
  const activeTotalPages =
    isCampaignScope && effectiveSearch.trim() && batchSearchRows
      ? Math.max(1, Math.ceil(batchSearchRows.length / pageSize))
      : totalPages

  const displayColumns = useMemo(() => columnsFromData(activeRows, []), [activeRows])

  useEffect(() => {
    if (!agentId) return
    void fetchCallLogs(false)
  }, [agentId, fetchCallLogs])

  useEffect(() => {
    if (!agentId) return
    refreshIntervalRef.current = setInterval(() => void fetchCallLogs(true), 30000)
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
  }, [agentId, fetchCallLogs])

  const goToPage = (newPage: number) => {
    if (newPage >= 1 && newPage <= activeTotalPages) setPage(newPage)
  }

  const handlePlayPause = (recordUrl: string) => {
    const audioEl = document.getElementById('call-logs-audio-player')
    if (!(audioEl instanceof HTMLAudioElement)) return

    if (currentlyPlaying === recordUrl) {
      audioEl.pause()
      setCurrentlyPlaying(null)
      return
    }

    setCurrentlyPlaying(recordUrl)
    audioEl.src = recordUrl
    void audioEl.play()
  }

  useEffect(() => {
    const audioEl = document.getElementById('call-logs-audio-player')
    if (!(audioEl instanceof HTMLAudioElement)) return

    const handleEnded = () => setCurrentlyPlaying(null)
    const handlePause = () => {
      if (audioEl.ended) return
      setCurrentlyPlaying((current) => (audioEl.src && current ? null : current))
    }

    audioEl.addEventListener('ended', handleEnded)
    audioEl.addEventListener('pause', handlePause)
    return () => {
      audioEl.removeEventListener('ended', handleEnded)
      audioEl.removeEventListener('pause', handlePause)
    }
  }, [])

  const handleDownload = async () => {
    if (!agentId) return
    setIsDownloading(true)
    try {
      const params = new URLSearchParams({
        download: 'true',
      })
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)
      if (search) params.append('search', search)
      if (batchId) params.append('batchId', batchId)

      const response = await apiFetch(`/api/dashboard/calllogs/${agentId}?${params}`)
      if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to download call logs. Please try again.')
      const data = await response.json()
      
      const allLogs = data.pages?.[1] || []
      
      if (allLogs.length === 0) {
        alert('No data available to download.')
        return
      }

      const csv = Papa.unparse(allLogs)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CallLogs_${agent?.name || 'Agent'}_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download failed', e)
      alert('Failed to download call logs. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  const renderPaginationButtons = () => {
    const buttons: ReactNode[] = []
    const maxVisiblePages = 5
    let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2))
    let endPage = Math.min(activeTotalPages, startPage + maxVisiblePages - 1)
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }
    if (startPage > 1) {
      buttons.push(
        <Button key="first" type="button" variant="secondary" size="sm" className="h-8 min-w-8 px-2" onClick={() => goToPage(1)}>
          1
        </Button>
      )
      if (startPage > 2) buttons.push(<span key="e1" className="px-1 text-muted-foreground">…</span>)
    }
    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <Button key={i} type="button" variant={i === page ? 'default' : 'secondary'} size="sm" className="h-8 min-w-8 px-2" onClick={() => goToPage(i)}>
          {i}
        </Button>
      )
    }
    if (endPage < activeTotalPages) {
      if (endPage < activeTotalPages - 1) buttons.push(<span key="e2" className="px-1 text-muted-foreground">…</span>)
      buttons.push(
        <Button key="last" type="button" variant="secondary" size="sm" className="h-8 min-w-8 px-2" onClick={() => goToPage(activeTotalPages)}>
          {activeTotalPages}
        </Button>
      )
    }
    return buttons
  }

  const renderCell = (row: any, columnId: string) => {
    const rawValue = row[columnId]
    if (!rawValue) return <span className="text-slate-400">N/A</span>

    if (columnId === 'Date') {
      const d = new Date(rawValue)
      if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(rawValue).trim())) {
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
      }
      return String(rawValue)
    }

    if (columnId === 'StartTime' || columnId === 'EndTime') {
      return String(rawValue).length <= 8 ? String(rawValue) : String(rawValue).slice(-8)
    }

    if (columnId === 'Direction') {
      const dir = String(rawValue).toLowerCase()
      if (dir === 'inbound') return <span className="inline-flex items-center gap-1.5"><ArrowDownLeft className="h-3.5 w-3.5 text-blue-500" /> Inbound</span>
      if (dir === 'outbound') return <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-amber-500" /> Outbound</span>
      return String(rawValue)
    }

    if (columnId === 'Status') {
      const status = String(rawValue).toLowerCase()
      if (status === 'completed' || status === 'answered') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">{rawValue}</span>
      if (status === 'failed' || status === 'dropped') return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">{rawValue}</span>
      if (status === 'busy') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{rawValue}</span>
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">{rawValue}</span>
    }

    if (columnId.toLowerCase().includes('recording') && (String(rawValue).startsWith('http') || String(rawValue).startsWith('//'))) {
      if (!rawValue) return <span className="text-slate-400">N/A</span>
      return (
        <Button
          type="button"
          size="icon"
          variant={currentlyPlaying === rawValue ? 'default' : 'secondary'}
          className={cn("h-8 w-8 rounded-full shadow-sm transition-all hover:scale-105", currentlyPlaying === rawValue && "animate-pulse")}
          onClick={() => handlePlayPause(rawValue)}
        >
          {currentlyPlaying === rawValue ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      )
    }

    return <span className="truncate">{String(rawValue)}</span>
  }

  if (batchIdRequired && !batchId?.trim()) {
    return (
      <div className="space-y-4">
        <Card className="rounded-lg border-dashed p-8 text-center shadow-none">
          <p className="text-sm font-medium text-slate-900">No batch linked to this campaign</p>
          <p className="mt-1 text-sm text-slate-500">Import leads with a batch_id or create the campaign to assign one.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Call Logs</h2>
          <p className="text-slate-600">{subtitle ?? agent?.name ?? ''}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Button>
      </div>

      <Card className="min-h-[80vh] relative">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-[1px] rounded-xl">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        <CardContent className="p-4 pt-6 sm:p-6">
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
                          setSearchInput(e.target.value)
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
                        setStartDate(e.target.value)
                        setPage(1)
                      }}
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="date"
                      className="w-auto"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value)
                        setPage(1)
                      }}
                    />
                  </div>
                </div>
                <Button onClick={handleDownload} disabled={isDownloading || loading || activeRows.length === 0} className="gap-2">
                  {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download
                </Button>
              </div>

              <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, activeTotalCount)} of {activeTotalCount} results
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => goToPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex flex-wrap items-center gap-1">{renderPaginationButtons()}</div>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page === activeTotalPages} onClick={() => goToPage(page + 1)}>
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
                      <TableHead key={column.id} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide bg-slate-50 text-slate-600">
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
              <TableBody>
                {activeRows.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={Math.max(displayColumns.length, 5)} className="h-40 text-center align-middle text-muted-foreground">
                      {isCampaignScope ? 'No call logs found for this campaign batch' : 'No call logs found for this agent'}
                    </TableCell>
                  </TableRow>
                ) : activeRows.length === 0 && loading ? (
                  <TableRow>
                    <TableCell colSpan={Math.max(displayColumns.length, 5)} className="h-40 text-center align-middle">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">Loading logs…</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  activeRows.map((row, index) => (
                    <TableRow key={index}>
                      {displayColumns.map((column) => (
                        <TableCell key={column.id} className="min-w-[120px] max-w-[280px] px-4 py-3 text-sm text-slate-700">
                          {renderCell(row, column.id)}
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
      <audio id="call-logs-audio-player" style={{ display: 'none' }} />
    </div>
  )
}
