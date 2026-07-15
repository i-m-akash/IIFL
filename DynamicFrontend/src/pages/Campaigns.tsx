import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { matchPath, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileDown,
  Loader2,
  Lock,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Table2,
  Target,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import CallAnalytics from '../components/AIAgents/CallAnalytics'
import CallLogs from '../components/AIAgents/CallLogs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiErrorFromResponse, apiFetch, getUserErrorMessage } from '@/lib/api'
import { brandSearchInputClass } from '@/lib/brandCss'
import { leadSearchHaystack, matchesCampaignSearch } from '@/lib/campaignSearch'
import { canViewAgentInsights } from '@/lib/roles'
import { useAuth } from '@/providers/AuthProvider'
import { cn } from '@/lib/utils'

type CampaignStatus = 'live' | 'scheduled' | 'completed' | 'draft' | string

type CampaignMetrics = {
  total?: number
  totalTriggered?: number
  totalLeads?: number
  totalCalls?: number
  pending?: number
  completed?: number
  answered?: number
  unanswered?: number
  failed?: number
  answerRate?: number
  promiseToPay?: number
}

type CampaignOutcomes = {
  ptp?: number
  dropped?: number
  busy?: number
  noResponse?: number
}

type ColumnSchema = {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'phone' | 'currency' | 'date' | string
  system?: boolean
}

type Campaign = {
  id: string
  name: string
  clientId?: string
  clientName?: string
  companyName?: string
  agent_id?: string
  agentName?: string
  batch_id?: string | null
  languages?: string[]
  metadata?: string
  status: CampaignStatus
  scheduledAt?: string
  createdAt?: string
  updatedAt?: string
  metrics?: CampaignMetrics
  outcomes?: CampaignOutcomes
  columnsSchema?: ColumnSchema[]
  source?: 'd1' | 'postgres' | 'merged'
}

type CampaignDetailContext = {
  campaign: Campaign
  leads: LeadRecord[]
  loadingLeads: boolean
  refreshDetail: () => Promise<void>
  campaignSearch: string
  batchId: string
}

type CampaignListResponse = {
  success?: boolean
  data?: Campaign[]
}

type CampaignDetailResponse = {
  success?: boolean
  data?: Campaign
}

type SchedulerTickResponse = {
  success?: boolean
  data?: {
    now?: string
    candidateCount?: number
    triggeredCampaignIds?: string[]
    skipped?: Array<{ campaignId: string; reason: string }>
    failed?: Array<{ campaignId: string; reason: string }>
  }
}

type LeadRecord = {
  id?: string
  reference_id?: string
  party_name?: string
  party_mobile_number?: string
  callStatus?: string
  uploadTimestamp?: string
  createdAt?: string
  scheduledDateTime?: string
  scheduledAt?: string
  data?: Record<string, unknown>
  extraData?: Record<string, unknown>
  [key: string]: unknown
}

type RetrySelection = 'unanswered' | 'short_answered' | 'combined'

type RetryCampaignFormValue = {
  selection: RetrySelection
  shortCallThresholdSec: number
  scheduledAt: string
  name: string
}

type LeadsResponse = {
  success?: boolean
  data?: LeadRecord[] | { leads?: LeadRecord[]; customers?: LeadRecord[] }
}

type ImportResult = {
  processedCount: number
  successCount: number
  errorCount: number
  leads?: LeadRecord[]
  columnsSchema?: ColumnSchema[]
  postgresDumpSkipped?: boolean
  warning?: string
}

type ClientOption = {
  id: string
  name: string
}

type AgentOption = {
  agent_id: string
  name: string
}

type CampaignFormValue = {
  id?: string
  name: string
  clientId: string
  clientName?: string
  agent_id: string
  agentName?: string
  languages: string[]
  scheduledAt: string
  columnsSchema: ColumnSchema[]
  importFile?: File | null
}

async function readCampaignsFromApi(filters?: { date?: string; agent?: string }) {
  const params = new URLSearchParams()
  if (filters?.date) params.set('date', filters.date)
  if (filters?.agent) params.set('agent', filters.agent)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/campaigns${query}`)
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load campaigns. Please refresh and try again.')

  const result = (await response.json()) as CampaignListResponse
  if (Array.isArray(result.data)) return result.data

  throw new Error('Campaign API response did not include data')
}

function todayIstDateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function campaignApiPath(campaignId: string) {
  return encodeURIComponent(campaignId)
}

function routeCampaignId(raw?: string) {
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function readCampaignDetailFromApi(campaignId: string) {
  const response = await apiFetch(`/api/campaigns/${campaignApiPath(campaignId)}`)
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load campaign details. Please refresh and try again.')

  const result = (await response.json()) as CampaignDetailResponse
  if (result.success && result.data) return result.data

  throw new Error('Campaign detail API response did not include data')
}

async function triggerSchedulerTick() {
  const response = await apiFetch('/api/test-scheduler')
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to refresh campaign status right now.')
  return (await response.json()) as SchedulerTickResponse
}

async function readCampaignLeadsFromApi(
  campaignId: string,
  opts?: { batchId?: string | null; agentId?: string | null },
) {
  const params = new URLSearchParams()
  const batchId = opts?.batchId?.trim()
  const agentId = opts?.agentId?.trim()
  if (batchId) params.set('batchId', batchId)
  if (agentId) params.set('agent', agentId)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/campaigns/${campaignApiPath(campaignId)}/leads${query}`)
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load campaign leads. Please refresh and try again.')

  const result = (await response.json()) as LeadsResponse
  if (!result.success || !result.data) throw new Error('Campaign leads API response did not include data')
  if (Array.isArray(result.data)) return result.data
  if (Array.isArray(result.data.leads)) return result.data.leads
  if (Array.isArray(result.data.customers)) return result.data.customers

  throw new Error('Campaign leads API response did not include a leads array')
}

async function readCampaignClients() {
  const response = await apiFetch('/api/campaigns/clients')
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load clients. Please refresh and try again.')
  const result = (await response.json()) as { success?: boolean; data?: ClientOption[] }
  if (result.success && Array.isArray(result.data)) return result.data
  throw new Error('Clients API response did not include data')
}

async function readAgents() {
  const response = await apiFetch('/api/agents')
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load agents. Please refresh and try again.')
  const result = (await response.json()) as { success?: boolean; data?: AgentOption[] }
  if (result.success && Array.isArray(result.data)) return result.data
  throw new Error('Agents API response did not include data')
}

async function saveCampaignToApi(value: CampaignFormValue) {
  const payload = {
    name: value.name,
    clientId: value.clientId,
    agent_id: value.agent_id,
    languages: value.languages,
    scheduledAt: value.scheduledAt,
    columnsSchema: normalizeColumns(value.columnsSchema),
  }

  const response = await apiFetch(value.id ? `/api/campaigns/${campaignApiPath(value.id)}` : '/api/campaigns', {
    method: value.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(response, 'Unable to save the campaign. Please try again.')
  }
  const result = (await response.json()) as { success?: boolean; data?: Campaign }
  if (result.success && result.data) return result.data
  throw new Error('Save campaign API response did not include data')
}

async function recreateCampaignToApi(campaignId: string, value: RetryCampaignFormValue) {
  const response = await apiFetch(`/api/campaigns/${campaignApiPath(campaignId)}/recreate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })

  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to create the retry campaign. Please try again.')

  const result = (await response.json().catch(() => null)) as { success?: boolean; data?: Campaign; error?: string } | null
  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'Unable to create the retry campaign. Please try again.')
  }

  return result.data
}

async function importCampaignLeadsToApi(campaignId: string, file: File, scheduleDateTime?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (scheduleDateTime) formData.append('scheduleDateTime', scheduleDateTime)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000) // 60s timeout

  try {
    const response = await apiFetch(`/api/campaigns/${campaignApiPath(campaignId)}/import`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw await apiErrorFromResponse(response, 'Unable to import leads. Please check the CSV and try again.')
    }

    const result = (await response.json()) as { success?: boolean; data?: ImportResult }
    if (result.success && result.data) return result.data
    throw new Error('Import API response did not include data')
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Import timed out after 60 seconds. The server might be busy processing the CSV.')
    }
    throw error
  }
}

const requiredColumns: ColumnSchema[] = [
  { key: 'reference_id', label: 'Reference ID', required: true, type: 'text', system: true },
  { key: 'party_name', label: 'Party Name', required: true, type: 'text', system: true },
  { key: 'party_mobile_number', label: 'Party Mobile Number', required: true, type: 'phone', system: true },
]


function formatNumber(value?: number) {
  return typeof value === 'number' ? value.toLocaleString('en-IN') : '0'
}

function getTotal(metrics?: CampaignMetrics) {
  return metrics?.totalTriggered ?? metrics?.total ?? metrics?.totalLeads ?? metrics?.totalCalls ?? 0
}

function getAnswered(metrics?: CampaignMetrics) {
  return metrics?.answered ?? metrics?.completed ?? 0
}

function getStatusLabel(status: CampaignStatus) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Draft'
}

function getStatusClasses(status: CampaignStatus) {
  const normalized = status?.toLowerCase()
  if (normalized === 'live') return 'bg-emerald-100 text-emerald-700 ring-emerald-200'
  if (normalized === 'completed') return 'bg-slate-200 text-slate-700 ring-slate-300'
  if (normalized === 'pending') return 'bg-blue-100 text-blue-700 ring-blue-200'
  if (normalized === 'scheduled') return 'bg-amber-100 text-amber-800 ring-amber-200'
  return 'bg-blue-100 text-blue-700 ring-blue-200'
}

function getCallStatusClasses(status?: string) {
  const normalized = status?.toLowerCase()
  if (normalized === 'completed' || normalized === 'answered') return 'bg-emerald-100 text-emerald-700 ring-emerald-200'
  if (normalized === 'failed' || normalized === 'dropped') return 'bg-red-100 text-red-700 ring-red-200'
  if (normalized === 'processing') return 'bg-sky-100 text-sky-700 ring-sky-200'
  if (normalized === 'busy') return 'bg-slate-200 text-slate-700 ring-slate-300'
  return 'bg-amber-100 text-amber-800 ring-amber-200'
}

function formatCellValue(value: unknown, type?: string) {
  if (value === null || value === undefined || value === '') return '-'

  if (type === 'currency') {
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
    if (!Number.isNaN(numeric)) {
      return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(numeric)
    }
  }

  if (type === 'date') {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    }
  }

  return String(value)
}

function formatDateTime(value?: unknown) {
  if (!value) return '-'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return '-'

  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getLeadValue(lead: LeadRecord, key: string) {
  if (lead[key] !== undefined) return lead[key]
  if (lead.data?.[key] !== undefined) return lead.data[key]
  if (lead.extraData?.[key] !== undefined) return lead.extraData[key]
  return undefined
}

function isUnansweredStatus(status?: string) {
  const normalized = String(status ?? '').trim().toLowerCase()
  return ['failed', 'dropped', 'busy', 'no_response', 'no response', 'unanswered'].includes(normalized)
}

function isAnsweredStatus(status?: string) {
  const normalized = String(status ?? '').trim().toLowerCase()
  return ['completed', 'answered'].includes(normalized)
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)

  const hhmmss = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (hhmmss) {
    const first = Number(hhmmss[1] ?? 0)
    const second = Number(hhmmss[2] ?? 0)
    const third = Number(hhmmss[3] ?? 0)
    return hhmmss[3] ? first * 3600 + second * 60 + third : first * 60 + second
  }

  const units = raw.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i)
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  }

  return null
}

function getLeadCallDurationSeconds(lead: LeadRecord) {
  const extra = lead.extraData ?? {}
  const webhook = extra.webhook && typeof extra.webhook === 'object' ? (extra.webhook as Record<string, unknown>) : extra
  const candidates = [
    webhook.durationSec,
    webhook.duration_sec,
    webhook.durationSeconds,
    webhook.duration_seconds,
    webhook.callDuration,
    webhook.call_duration,
    webhook.talkTime,
    webhook.talk_time,
    webhook.conversationDuration,
    webhook.conversation_duration,
    webhook.billsec,
  ]

  for (const candidate of candidates) {
    const seconds = parseDurationSeconds(candidate)
    if (seconds !== null) return seconds
  }

  return null
}

function countRetryEligibleLeads(leads: LeadRecord[], selection: RetrySelection, shortCallThresholdSec: number) {
  return leads.filter((lead) => {
    const unanswered = isUnansweredStatus(lead.callStatus)
    const durationSec = getLeadCallDurationSeconds(lead)
    const shortAnswered = isAnsweredStatus(lead.callStatus) && durationSec !== null && durationSec <= shortCallThresholdSec

    if (selection === 'unanswered') return unanswered
    if (selection === 'short_answered') return shortAnswered
    return unanswered || shortAnswered
  }).length
}

function normalizeColumns(columns?: ColumnSchema[]) {
  const source = columns?.length ? columns : requiredColumns
  const seen = new Set<string>()
  const normalized: ColumnSchema[] = []

  for (const column of [...requiredColumns, ...source]) {
    if (!column.key || seen.has(column.key)) continue
    seen.add(column.key)
    normalized.push(column)
  }

  return normalized
}

function toColumnKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}



function toDatetimeLocal(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function fromDatetimeLocal(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function localCampaignId(name: string) {
  const key = toColumnKey(name) || 'campaign'
  return `${key}-${Date.now().toString(36)}`
}

function formValueToCampaign(value: CampaignFormValue, existing?: Campaign): Campaign {
  return {
    ...(existing ?? {}),
    id: value.id ?? localCampaignId(value.name),
    name: value.name.trim(),
    clientId: value.clientId || existing?.clientId,
    clientName: value.clientName,
    agent_id: value.agent_id || existing?.agent_id,
    languages: value.languages,
    status: existing?.status ?? 'pending',
    agentName: value.agentName,
    scheduledAt: value.scheduledAt,
    metrics: existing?.metrics ?? { total: 0, pending: 0, completed: 0, failed: 0, answerRate: 0, promiseToPay: 0 },
    outcomes: existing?.outcomes ?? { ptp: 0 },
    columnsSchema: normalizeColumns(value.columnsSchema),
  }
}

function campaignToFormValue(campaign?: Campaign): CampaignFormValue {
  return {
    id: campaign?.id,
    name: campaign?.name ?? '',
    clientId: campaign?.clientId ?? '',
    clientName: campaign?.clientName ?? campaign?.companyName ?? '',
    agent_id: campaign?.agent_id ?? '',
    agentName: campaign?.agentName ?? '',
    languages: campaign?.languages ?? [],
    scheduledAt: campaign?.scheduledAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    columnsSchema: normalizeColumns(campaign?.columnsSchema),
    importFile: null,
  }
}

function inferExtraColumns(leads: LeadRecord[], existingColumns: ColumnSchema[]) {
  const existing = new Set(existingColumns.map((column) => column.key))
  const extraKeys = new Set<string>()

  for (const lead of leads) {
    for (const key of Object.keys(lead.data ?? {})) {
      if (!existing.has(key)) extraKeys.add(key)
    }
    for (const key of Object.keys(lead.extraData ?? {})) {
      if (!existing.has(key)) extraKeys.add(key)
    }
  }

  return Array.from(extraKeys).map((key) => ({
    key,
    label: key
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    type: 'text',
  }))
}

function buildSampleCsv(columns: ColumnSchema[]) {
  const headers = columns.map((column) => column.label).join(',')
  return `${headers}\n${columns.map(() => '').join(',')}\n${columns.map(() => '').join(',')}\n`
}

function downloadTextFile(fileName: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(link)
}


/** Most recent activity: edits surface above older rows. */
function getCampaignRecencyMs(campaign: Campaign): number {
  const raw = campaign.updatedAt ?? campaign.createdAt
  if (!raw) return 0
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

function getCampaignDate(campaign: Campaign) {
  const raw = campaign.scheduledAt ?? campaign.createdAt ?? campaign.updatedAt
  const date = raw ? new Date(raw) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function getCampaignDateMs(campaign: Campaign): number {
  return getCampaignDate(campaign).getTime()
}

/** Group headers by scheduled day (when the run is planned); sort order uses recency separately. */
function getCampaignDateKey(campaign: Campaign) {
  const date = getCampaignDate(campaign)
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function formatCampaignGroupTitle(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, (month ?? 1) - 1, day ?? 1)
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const label = dateKey === todayKey ? 'Today' : date.toLocaleDateString('en-IN', { weekday: 'long' })
  const formattedDate = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${label}, ${formattedDate}`
}

function formatCampaignListDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function compactBatchId(value?: string | null) {
  const batch = value?.trim()
  if (!batch) return 'No batch'
  return batch.length > 18 ? `${batch.slice(0, 16)}...` : batch
}

function groupCampaignsByDate(campaigns: Campaign[]) {
  const groups = new Map<string, Campaign[]>()

  for (const campaign of campaigns) {
    const key = getCampaignDateKey(campaign)
    groups.set(key, [...(groups.get(key) ?? []), campaign])
  }

  return Array.from(groups.entries())
    .sort((a, b) => {
      const maxB = b[1].length ? Math.max(...b[1].map(getCampaignRecencyMs)) : 0
      const maxA = a[1].length ? Math.max(...a[1].map(getCampaignRecencyMs)) : 0
      return maxB - maxA
    })
    .map(([dateKey, items]) => ({
      dateKey,
      title: formatCampaignGroupTitle(dateKey),
      campaigns: [...items].sort((left, right) => getCampaignRecencyMs(right) - getCampaignRecencyMs(left)),
    }))
}

function CampaignCard({ campaign, onOpen }: { campaign: Campaign; onOpen: (campaign: Campaign) => void }) {
  const metrics = campaign.metrics ?? {}
  const total = getTotal(metrics)
  const answered = getAnswered(metrics)
  const unanswered = metrics.unanswered ?? 0
  const progress = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0
  const answerRate = typeof metrics.answerRate === 'number' ? metrics.answerRate : progress
  const ptp = metrics.promiseToPay ?? campaign.outcomes?.ptp ?? 0
  const ptpRate = total > 0 ? Math.round((ptp / total) * 100) : 0
  const showPtp = campaign.source !== 'postgres' && campaign.source !== 'merged'
  const displayTitle = campaign.name || campaign.clientName || campaign.companyName || 'Campaign'
  const startDate = formatCampaignListDate(campaign.scheduledAt ?? campaign.createdAt ?? campaign.updatedAt)
  const endDate = formatCampaignListDate(campaign.scheduledAt ?? campaign.updatedAt ?? campaign.createdAt)

  return (
    <motion.button
      type="button"
      className="group w-full text-left"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      onClick={() => onOpen(campaign)}
    >
      <Card className="rounded-[20px] border-slate-200 bg-white shadow-sm transition duration-200 hover:border-slate-300 hover:shadow-md">
        <div className="flex flex-col gap-5 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-slate-950">{displayTitle}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                <span className="min-w-0">
                  Batch:{' '}
                  <span className="font-mono text-xs text-slate-800" title={campaign.batch_id ?? campaign.id}>
                    {compactBatchId(campaign.batch_id ?? campaign.id)}
                  </span>
                </span>
                <span>{startDate} -&gt; {endDate}</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2 text-sm text-slate-400">
                <span>Answered / Triggered:</span>
                <span className="text-base font-bold text-emerald-600">{formatNumber(answered)}</span>
                <span>/</span>
                <span className="text-base font-bold text-slate-950">{formatNumber(total)}</span>
                <span className="font-medium text-emerald-600">({answerRate}%)</span>
              </div>
              <div className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <div className="shrink-0 text-left md:min-w-[150px] md:text-right">
            <div className="text-2xl font-bold tracking-tight text-slate-950">{formatNumber(total)}</div>
            <div className="mt-1 text-sm text-slate-400">triggered</div>
            {showPtp ? (
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {formatNumber(ptp)} PTP ({ptpRate}%)
                </span>
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-amber-600">
                <Phone className="h-4 w-4" />
                <span>{formatNumber(unanswered)} unanswered</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.button>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-xl font-bold text-slate-950">{value}</div>
    </div>
  )
}

function CampaignFormModal({
  campaign,
  open,
  onClose,
  onSave,
}: {
  campaign?: Campaign
  open: boolean
  onClose: () => void
  onSave: (value: CampaignFormValue) => Promise<void>
}) {
  if (!open) return null

  return <CampaignFormDialog key={campaign?.id ?? 'new-campaign'} campaign={campaign} onClose={onClose} onSave={onSave} />
}

const LANGUAGE_OPTIONS = [
  'English',
  'Hindi',
  'Bengali',
  'Marathi',
  'Telugu',
  'Tamil',
  'Gujarati',
  'Kannada',
  'Odia',
  'Malayalam',
  'Punjabi',
  'Assamese',
]

function CampaignFormDialog({
  campaign,
  onClose,
  onSave,
}: {
  campaign?: Campaign
  onClose: () => void
  onSave: (value: CampaignFormValue) => Promise<void>
}) {
  const initialValue = campaignToFormValue(campaign)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(initialValue.name)
  const [clientId, setClientId] = useState(initialValue.clientId)
  const [agentId, setAgentId] = useState(initialValue.agent_id)
  const [languagesText, setLanguagesText] = useState(initialValue.languages.join(', '))
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(initialValue.scheduledAt))
  const [importFile, setImportFile] = useState<File | null>(initialValue.importFile ?? null)

  useEffect(() => {
    let cancelled = false

    Promise.all([readCampaignClients().catch(() => []), readAgents().catch(() => [])])
      .then(([nextClients, nextAgents]) => {
        if (cancelled) return
        setClients(nextClients)
        setAgents(nextAgents)
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleClientChange = (nextClientId: string) => {
    setClientId(nextClientId)
  }

  const handleAgentChange = (nextAgentId: string) => {
    setAgentId(nextAgentId)
  }

  const handleDownloadSample = () => {
    const nameStr = name.trim() || 'campaign'
    const csvContent = 'name,mobile_number\nJohn Doe,9999999999\nJane Smith,9876543210\n'
    downloadTextFile(
      `${nameStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-sample.csv`,
      csvContent
    )
    toast.success('Sample CSV downloaded')
  }

  const handleSubmit = async () => {
    const cleanName = name.trim()

    if (!cleanName) {
      toast.error('Campaign name is required')
      return
    }
    if (!clientId) {
      toast.error('Select a client')
      return
    }
    if (!agentId) {
      toast.error('Select an agent')
      return
    }
    if (!scheduledAt) {
      toast.error('Schedule is required')
      return
    }
    setSaving(true)
    try {
      await onSave({
        id: campaign?.id,
        name: cleanName,
        clientId,
        clientName: clients.find((item) => item.id === clientId)?.name ?? initialValue.clientName,
        agent_id: agentId,
        agentName: agents.find((item) => item.agent_id === agentId)?.name ?? initialValue.agentName,
        languages: languagesText
          .split(',')
          .map((language) => language.trim())
          .filter(Boolean),
        scheduledAt: fromDatetimeLocal(scheduledAt),
        columnsSchema: normalizeColumns(campaign?.columnsSchema),
        importFile,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{campaign ? 'Edit Campaign' : 'Create Campaign'}</h2>
            <p className="mt-1 text-sm text-slate-500">Create campaigns quickly. Lead columns are detected from import files.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close campaign form">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Campaign name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Personal Loan Reminders" />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Client</span>
              <select
                value={clientId}
                onChange={(event) => handleClientChange(event.target.value)}
                disabled={loadingOptions}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="">Select client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {!loadingOptions && clients.length === 0 && (
                <p className="text-xs font-medium text-red-600">No clients found. Add a client before creating campaigns.</p>
              )}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Agent</span>
              <select
                value={agentId}
                onChange={(event) => handleAgentChange(event.target.value)}
                disabled={loadingOptions}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="">Select agent</option>
                {agents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              {!loadingOptions && agents.length === 0 && (
                <p className="text-xs font-medium text-red-600">No agents found. Create an agent before creating campaigns.</p>
              )}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Languages</span>
              <select
                value={languagesText}
                onChange={(event) => setLanguagesText(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select language</option>
                {LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Schedule</span>
              <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Initial Import</span>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file && file.name.split('.').pop()?.toLowerCase() !== 'csv' && file.type !== 'text/csv') {
                    toast.error('Only CSV upload is supported currently.')
                    event.target.value = ''
                    setImportFile(null)
                  } else {
                    setImportFile(file || null)
                  }
                }}
                disabled={saving}
                className="h-auto py-2"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>You can upload a CSV file now to populate leads immediately.</span>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="text-primary hover:underline font-semibold flex items-center gap-1 shrink-0"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Download Sample CSV
                </button>
              </div>
            </label>
          </div>


        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : campaign ? 'Save Changes' : 'Create Campaign'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function CampaignsIndex({
  campaigns,
  loading,
  listDate,
  listAgent,
  agents,
  onListDateChange,
  onListAgentChange,
  onSaveCampaign,
}: CampaignsIndexProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { adminSlug } = useParams()

  const filteredCampaigns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return campaigns.filter((campaign) => {
      const searchMatches =
        !query ||
        campaign.name.toLowerCase().includes(query) ||
        (campaign.clientName ?? campaign.companyName ?? '').toLowerCase().includes(query) ||
        campaign.languages?.join(' ').toLowerCase().includes(query)

      return searchMatches
    })
  }, [campaigns, searchTerm])
  const listedCampaigns = useMemo(
    () => [...filteredCampaigns].sort((left, right) => getCampaignDateMs(right) - getCampaignDateMs(left)),
    [filteredCampaigns]
  )

  const handleOpenCampaign = (campaign: Campaign) => {
    navigate(`/${adminSlug}/campaigns/${campaignApiPath(campaign.id)}/leads`)
  }

  return (
    <div className="w-full px-3 py-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Campaign Control Center</h1>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-3xl lg:flex-1 lg:justify-end">
          <select
            value={listAgent}
            onChange={(event) => onListAgentChange(event.target.value)}
            className={cn(
              'h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 sm:max-w-[200px]',
              brandSearchInputClass,
            )}
            title="Filter by agent"
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.name}
              </option>
            ))}
          </select>

          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={dateInputRef}
              type="date"
              value={listDate}
              onChange={(event) => onListDateChange(event.target.value)}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            />
            <Button
              type="button"
              variant="outline"
              className={cn('h-10 w-10 p-0', listDate && 'border-primary text-primary')}
              title={listDate ? `Filtered: ${listDate}` : 'Filter by date'}
              onClick={() => {
                const input = dateInputRef.current
                if (!input) return
                if (typeof input.showPicker === 'function') input.showPicker()
                else input.click()
              }}
            >
              <CalendarClock className="h-4 w-4" />
            </Button>
            {listDate ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-10 p-0"
                title="Clear date filter"
                onClick={() => onListDateChange('')}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search campaigns..."
              className={cn('h-10 w-full bg-white pl-9', brandSearchInputClass)}
            />
          </label>

          <Button type="button" onClick={() => setShowCreateModal(true)} className="h-10 shrink-0">
            <Plus className="h-4 w-4" />
            Create Campaign
          </Button>
        </div>
      </div>



      {loading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-[20px] border border-slate-200 bg-white py-16">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
          <p className="text-sm font-medium text-slate-600">Loading campaigns…</p>
        </div>
      ) : filteredCampaigns.length > 0 ? (
        <div className="space-y-4">
          {listedCampaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} onOpen={handleOpenCampaign} />
          ))}
        </div>
      ) : (
        <Card className="rounded-lg border-dashed border-slate-300 bg-white p-10 text-center shadow-none">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
            <Target className="h-6 w-6 text-slate-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-950">No campaigns found</h2>
          <p className="mt-2 text-sm text-slate-500">Try another search or status filter.</p>
        </Card>
      )}

      <CampaignFormModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onSave={onSaveCampaign} />
    </div>
  )
}

type CampaignsIndexProps = {
  campaigns: Campaign[]
  loading: boolean
  listDate: string
  listAgent: string
  agents: AgentOption[]
  onListDateChange: (dateKey: string) => void
  onListAgentChange: (agentId: string) => void
  onSaveCampaign: (value: CampaignFormValue) => Promise<void>
}

function LeadsTable({
  columns,
  leads,
  loading,
}: {
  columns: ColumnSchema[]
  leads: LeadRecord[]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    )
  }

  if (leads.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
          <Target className="h-6 w-6 text-slate-500" />
        </div>
        <h3 className="text-base font-semibold text-slate-950">No leads found</h3>
        <p className="mt-2 text-sm text-slate-500">Try changing the search or status filter.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50 hover:bg-slate-50">
          {columns.map((column) => (
            <TableHead key={column.key} className="min-w-36 whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-slate-500">
              {column.label}
            </TableHead>
          ))}
          <TableHead className="min-w-32 whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-slate-500">Call status</TableHead>
          <TableHead className="min-w-44 whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-slate-500">Uploaded</TableHead>
          <TableHead className="min-w-44 whitespace-nowrap px-4 py-3 text-xs font-bold uppercase text-slate-500">Scheduled</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead, index) => (
          <TableRow key={lead.id ?? String(lead.reference_id ?? index)} className="bg-white">
            {columns.map((column) => (
              <TableCell key={column.key} className="max-w-56 px-4 py-3 text-sm text-slate-700">
                <span className="block truncate" title={formatCellValue(getLeadValue(lead, column.key), column.type)}>
                  {formatCellValue(getLeadValue(lead, column.key), column.type)}
                </span>
              </TableCell>
            ))}
            <TableCell className="px-4 py-3">
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold ring-1', getCallStatusClasses(lead.callStatus))}>
                {getStatusLabel(lead.callStatus ?? 'pending')}
              </span>
            </TableCell>
            <TableCell className="px-4 py-3 text-sm text-slate-600">{formatDateTime(lead.uploadTimestamp ?? lead.createdAt)}</TableCell>
            <TableCell className="px-4 py-3 text-sm text-slate-600">{formatDateTime(lead.scheduledDateTime ?? lead.scheduledAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ImportLeadsModal({
  campaign,
  columns,
  open,
  onClose,
  onImport,
  onSampleDownload,
}: {
  campaign: Campaign
  columns: ColumnSchema[]
  open: boolean
  onClose: () => void
  onImport: (file: File, scheduleDateTime?: string) => Promise<void>
  onSampleDownload: () => void
}) {
  if (!open) return null

  return (
    <ImportLeadsDialog
      campaign={campaign}
      columns={columns}
      onClose={onClose}
      onImport={onImport}
      onSampleDownload={onSampleDownload}
    />
  )
}

function ImportLeadsDialog({
  campaign,
  columns,
  onClose,
  onImport,
  onSampleDownload,
}: {
  campaign: Campaign
  columns: ColumnSchema[]
  onClose: () => void
  onImport: (file: File, scheduleDateTime?: string) => Promise<void>
  onSampleDownload: () => void
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [scheduleDateTime, setScheduleDateTime] = useState(toDatetimeLocal(campaign.scheduledAt))
  const [importing, setImporting] = useState(false)

  const handleFileChange = (file?: File) => {
    if (!file) {
      setSelectedFile(null)
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension !== 'csv' && file.type !== 'text/csv') {
      toast.error('CSV upload is supported first. XLS/XLSX will come after backend support.')
      setSelectedFile(null)
      return
    }

    setSelectedFile(file)
  }

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error('Select a CSV file first')
      return
    }

    setImporting(true)
    try {
      await onImport(selectedFile, fromDatetimeLocal(scheduleDateTime))
      onClose()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Import Leads</h2>
            <p className="mt-1 text-sm text-slate-500">{campaign.name}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close import form">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Expected CSV columns</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {columns.map((column) => (
                <span key={column.key} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  {column.label}
                </span>
              ))}
            </div>
          </div>

          <label className="space-y-2 block">
            <span className="text-sm font-semibold text-slate-700">Schedule override</span>
            <Input type="datetime-local" value={scheduleDateTime} onChange={(event) => setScheduleDateTime(event.target.value)} />
          </label>

          <label className="space-y-2 block">
            <span className="text-sm font-semibold text-slate-700">CSV file</span>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => handleFileChange(event.target.files?.[0])}
              disabled={importing}
              className="h-auto py-2"
            />
            <span className="block text-xs text-slate-500">Only CSV is enabled until backend XLS/XLSX parsing exists.</span>
          </label>

          {selectedFile && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              Selected: {selectedFile.name}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onSampleDownload} disabled={importing}>
            <CalendarClock className="h-4 w-4" />
            Sample CSV
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button type="button" onClick={handleImport} disabled={importing || !selectedFile}>
            <Upload className="h-4 w-4" />
            {importing ? 'Importing...' : 'Import Leads'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function RetryCampaignModal({
  campaign,
  leads,
  open,
  onClose,
  onCreate,
}: {
  campaign: Campaign
  leads: LeadRecord[]
  open: boolean
  onClose: () => void
  onCreate: (value: RetryCampaignFormValue) => Promise<void>
}) {
  if (!open) return null
  return <RetryCampaignDialog campaign={campaign} leads={leads} onClose={onClose} onCreate={onCreate} />
}

function RetryCampaignDialog({
  campaign,
  leads,
  onClose,
  onCreate,
}: {
  campaign: Campaign
  leads: LeadRecord[]
  onClose: () => void
  onCreate: (value: RetryCampaignFormValue) => Promise<void>
}) {
  const [selection, setSelection] = useState<RetrySelection>('combined')
  const [shortCallThresholdSec, setShortCallThresholdSec] = useState(15)
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000).toISOString()))
  const [name, setName] = useState(`${campaign.name} Retry`)
  const [saving, setSaving] = useState(false)

  const eligibleCount = useMemo(
    () => countRetryEligibleLeads(leads, selection, shortCallThresholdSec),
    [leads, selection, shortCallThresholdSec],
  )

  const handleCreate = async () => {
    if (!scheduledAt) {
      toast.error('Schedule is required')
      return
    }
    if (!name.trim()) {
      toast.error('Campaign name is required')
      return
    }
    if (eligibleCount === 0) {
      toast.error('No leads match the selected retry criteria')
      return
    }

    setSaving(true)
    try {
      await onCreate({
        selection,
        shortCallThresholdSec,
        scheduledAt: fromDatetimeLocal(scheduledAt),
        name: name.trim(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Recreate Campaign</h2>
            <p className="mt-1 text-sm text-slate-500">Create a new campaign from unanswered or short-call leads.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close recreate form">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">New campaign name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${campaign.name} Retry`} />
          </label>

          <div className="space-y-3">
            <span className="text-sm font-semibold text-slate-700">Retry selection</span>
            <div className="grid gap-3">
              {[
                { value: 'unanswered' as const, label: 'Unanswered only', hint: 'Includes failed, dropped, busy, and no response leads.' },
                { value: 'short_answered' as const, label: 'Answered but cut quickly', hint: 'Includes answered/completed calls below the duration threshold.' },
                { value: 'combined' as const, label: 'Both groups', hint: 'Union of unanswered and short answered calls.' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelection(option.value)}
                  className={cn(
                    'rounded-lg border p-4 text-left transition',
                    selection === option.value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                  <div className="mt-1 text-sm text-slate-500">{option.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Short call threshold (seconds)</span>
            <Input
              type="number"
              min={1}
              max={600}
              value={shortCallThresholdSec}
              onChange={(event) => setShortCallThresholdSec(Math.max(1, Math.min(600, Number(event.target.value) || 15)))}
              disabled={selection === 'unanswered'}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Schedule</span>
            <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
          </label>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-sm font-semibold text-emerald-900">Eligible leads</div>
            <div className="mt-1 text-sm text-emerald-800">
              {eligibleCount.toLocaleString('en-IN')} lead{eligibleCount === 1 ? '' : 's'} match the current selection.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={saving || eligibleCount === 0}>
            <RotateCcw className="h-4 w-4" />
            {saving ? 'Creating...' : 'Create Retry Campaign'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function useCampaignDetail() {
  return useOutletContext<CampaignDetailContext>()
}

function campaignBatchId(campaign: Campaign) {
  return campaign.batch_id?.trim() || campaign.id
}

function campaignInsightsSubtitle(campaign: Campaign) {
  return `${campaign.name} · Batch ${campaignBatchId(campaign)}`
}

function CampaignDetailNav({
  adminSlug,
  campaignId,
  showInsights,
}: {
  adminSlug: string
  campaignId: string
  showInsights: boolean
}) {
  const base = `/${adminSlug}/campaigns/${campaignApiPath(campaignId)}`
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold transition',
      isActive
        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
    )

  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <NavLink to={`${base}/leads`} className={navClass}>
        <Table2 className="h-4 w-4" />
        Lead table
      </NavLink>
      {showInsights ? (
        <>
          <NavLink to={`${base}/logs`} className={navClass}>
            <Phone className="h-4 w-4" />
            Call logs
          </NavLink>
          <NavLink to={`${base}/analytics`} className={navClass}>
            <BarChart3 className="h-4 w-4" />
            Call analytics
          </NavLink>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" className="h-11 rounded-full" disabled>
            <Phone className="h-4 w-4" />
            Call logs
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-full" disabled>
            <BarChart3 className="h-4 w-4" />
            Call analytics
          </Button>
        </>
      )}
    </div>
  )
}

function CampaignLeadsView() {
  const { campaign, leads, loadingLeads, campaignSearch } = useCampaignDetail()
  const [statusFilter, setStatusFilter] = useState('all')
  const baseColumns = normalizeColumns(campaign.columnsSchema)
  const tableColumns = [...baseColumns, ...inferExtraColumns(leads, baseColumns)]
  const filteredLeads = leads.filter((lead) => {
    const normalizedStatus = lead.callStatus?.toLowerCase() ?? 'pending'
    const statusMatches = statusFilter === 'all' || normalizedStatus === statusFilter
    const haystack = leadSearchHaystack(lead, tableColumns.map((column) => column.key), getLeadValue)
    const searchMatches = matchesCampaignSearch(haystack, campaignSearch)

    return statusMatches && searchMatches
  })

  return (
    <Card className="mt-6 overflow-hidden rounded-lg shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Lead table</h2>
          <p className="mt-1 text-sm text-slate-500">
            {filteredLeads.length.toLocaleString('en-IN')} of {leads.length.toLocaleString('en-IN')} leads
            {campaignSearch.trim() ? ` matching “${campaignSearch.trim()}”` : ''}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-md lg:ml-auto">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          >
            <option value="all">All call status</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <LeadsTable columns={tableColumns} leads={filteredLeads} loading={loadingLeads} />
    </Card>
  )
}

function CampaignLogsView() {
  const { campaign, campaignSearch, batchId } = useCampaignDetail()
  const { adminSlug, campaignId } = useParams()
  const navigate = useNavigate()
  const agentId = campaign.agent_id?.trim()

  if (!agentId) {
    return (
      <Card className="mt-6 rounded-lg border-dashed p-8 text-center shadow-none">
        <p className="text-sm font-medium text-slate-900">No agent linked to this campaign</p>
        <p className="mt-1 text-sm text-slate-500">Assign an agent to view call logs for this batch.</p>
      </Card>
    )
  }

  return (
    <div className="mt-6">
      <CallLogs
        agent={{ agent_id: agentId, name: campaign.agentName }}
        batchId={batchId}
        batchIdRequired
        externalSearch={campaignSearch}
        hideSearchBar
        subtitle={campaignInsightsSubtitle(campaign)}
        backLabel="Back to campaign"
        onBack={() => navigate(`/${adminSlug}/campaigns/${campaignApiPath(campaignId!)}/leads`)}
      />
    </div>
  )
}

function CampaignAnalyticsView() {
  const { campaign, campaignSearch, batchId } = useCampaignDetail()
  const { adminSlug, campaignId } = useParams()
  const navigate = useNavigate()
  const agentId = campaign.agent_id?.trim()

  if (!agentId) {
    return (
      <Card className="mt-6 rounded-lg border-dashed p-8 text-center shadow-none">
        <p className="text-sm font-medium text-slate-900">No agent linked to this campaign</p>
        <p className="mt-1 text-sm text-slate-500">Assign an agent to view analytics for this batch.</p>
      </Card>
    )
  }

  return (
    <div className="mt-6">
      <CallAnalytics
        agent={{ agent_id: agentId, name: campaign.agentName }}
        batchId={batchId}
        batchIdRequired
        externalSearch={campaignSearch}
        hideSearchBar
        subtitle={campaignInsightsSubtitle(campaign)}
        backLabel="Back to campaign"
        onBack={() => navigate(`/${adminSlug}/campaigns/${campaignApiPath(campaignId!)}/leads`)}
      />
    </div>
  )
}

function CampaignDetailShell({
  campaigns,
  onSaveCampaign,
}: {
  campaigns: Campaign[]
  onSaveCampaign: (value: CampaignFormValue) => Promise<void>
}) {
  const { campaignId: routeCampaignIdParam, adminSlug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const resolvedCampaignId = routeCampaignId(routeCampaignIdParam)
  const campaignFromList = campaigns.find((item) => item.id === resolvedCampaignId)
  const [campaignDetail, setCampaignDetail] = useState<Campaign | null>(campaignFromList ?? null)
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loadingDetail, setLoadingDetail] = useState(true)
  const [loadingLeads, setLoadingLeads] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showRetryModal, setShowRetryModal] = useState(false)
  const [campaignSearchInput, setCampaignSearchInput] = useState('')
  const [campaignSearch, setCampaignSearch] = useState('')
  const campaign = campaignDetail ?? campaignFromList
  const showInsights = !!user && canViewAgentInsights(user.role)

  useEffect(() => {
    const timer = window.setTimeout(() => setCampaignSearch(campaignSearchInput), 300)
    return () => window.clearTimeout(timer)
  }, [campaignSearchInput])

  useEffect(() => {
    let cancelled = false
    if (!resolvedCampaignId) {
      setLoadingDetail(false)
      setLoadingLeads(false)
      return
    }

    setLoadingDetail(true)
    setLoadingLeads(true)
    setCampaignDetail(campaignFromList ?? null)

    const loadDetail = async () => {
      const nextCampaign =
        (await readCampaignDetailFromApi(resolvedCampaignId).catch(() => null)) ?? campaignFromList ?? null
      if (cancelled) return
      if (nextCampaign) setCampaignDetail(nextCampaign)

      const batchId = nextCampaign?.batch_id ?? campaignFromList?.batch_id
      const agentId = nextCampaign?.agent_id ?? campaignFromList?.agent_id
      const nextLeads = await readCampaignLeadsFromApi(resolvedCampaignId, { batchId, agentId })
      if (cancelled) return
      setLeads(nextLeads)
    }

    void loadDetail()
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to load campaign leads', error)
        setCampaignDetail(campaignFromList ?? null)
        setLeads([])
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false)
          setLoadingLeads(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [resolvedCampaignId, campaignFromList])

  const refreshDetail = useCallback(async () => {
    if (!resolvedCampaignId) return
    setLoadingLeads(true)
    try {
      const nextCampaign =
        (await readCampaignDetailFromApi(resolvedCampaignId).catch(() => null)) ?? campaignFromList ?? null
      if (nextCampaign) setCampaignDetail(nextCampaign)
      const batchId = nextCampaign?.batch_id ?? campaignFromList?.batch_id
      const agentId = nextCampaign?.agent_id ?? campaignFromList?.agent_id
      const nextLeads = await readCampaignLeadsFromApi(resolvedCampaignId, { batchId, agentId })
      setLeads(nextLeads)
    } catch (error) {
      console.error('Failed to load campaign leads', error)
      setCampaignDetail(campaignFromList ?? null)
      setLeads([])
    } finally {
      setLoadingLeads(false)
    }
  }, [resolvedCampaignId, campaignFromList])

  const outletContext = useMemo<CampaignDetailContext | null>(() => {
    if (!campaign) return null
    return {
      campaign,
      leads,
      loadingLeads,
      refreshDetail,
      campaignSearch,
      batchId: campaignBatchId(campaign),
    }
  }, [campaign, leads, loadingLeads, refreshDetail, campaignSearch])

  useEffect(() => {
    if (!resolvedCampaignId || !campaign || campaign.source === 'postgres') return

    const normalizedCampaignStatus = String(campaign.status ?? '').toLowerCase()
    const shouldPollCampaign = ['pending', 'live', 'scheduled', 'processing'].includes(normalizedCampaignStatus)
    const hasActiveLeads = leads.some((lead) => {
      const status = String(lead.callStatus ?? '').toLowerCase()
      return status === 'pending' || status === 'processing'
    })

    if (!shouldPollCampaign || !hasActiveLeads) return

    let cancelled = false
    const intervalId = window.setInterval(async () => {
      if (cancelled) return
      try {
        await refreshDetail()
      } catch (error) {
        if (!cancelled) console.error('Campaign detail auto-refresh failed', error)
      }
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [resolvedCampaignId, campaign, campaign?.status, leads, refreshDetail])

  useEffect(() => {
    if (!import.meta.env.DEV || !resolvedCampaignId || !campaign) return

    const normalizedStatus = String(campaign.status ?? '').toLowerCase()
    const hasPendingLeads = leads.some((lead) => String(lead.callStatus ?? 'pending').toLowerCase() === 'pending')
    if (!hasPendingLeads || (normalizedStatus !== 'pending' && normalizedStatus !== 'live')) return

    let cancelled = false

    const tick = async () => {
      try {
        const result = await triggerSchedulerTick()
        const touchedCampaign =
          result.data?.triggeredCampaignIds?.includes(resolvedCampaignId) ||
          result.data?.skipped?.some((item) => item.campaignId === resolvedCampaignId) ||
          result.data?.failed?.some((item) => item.campaignId === resolvedCampaignId)

        if (!cancelled && touchedCampaign) {
          await refreshDetail()
        }
      } catch (error) {
        if (!cancelled) console.error('Local scheduler heartbeat failed', error)
      }
    }

    void tick()
    const intervalId = window.setInterval(() => {
      void tick()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [resolvedCampaignId, campaign, campaign?.status, leads, refreshDetail])

  if (loadingDetail) {
    return (
      <div className="flex min-h-[320px] w-full flex-col items-center justify-center gap-3 px-3 py-16">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
        <p className="text-sm font-medium text-slate-600">Loading campaign…</p>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="w-full px-3 py-4">
        <Button type="button" variant="outline" onClick={() => navigate(`/${adminSlug}/campaigns`)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card className="mt-6 rounded-lg border-dashed p-10 text-center shadow-none">
          <h1 className="text-xl font-semibold text-slate-950">Campaign not found</h1>
          <p className="mt-2 text-sm text-slate-500">Refresh the campaign list and try again.</p>
        </Card>
      </div>
    )
  }

  const metrics = campaign.metrics ?? {}
  const total = getTotal(metrics)
  const isPostgresOnly = campaign.source === 'postgres'
  const baseColumns = normalizeColumns(campaign.columnsSchema)
  const tableColumns = [...baseColumns, ...inferExtraColumns(leads, baseColumns)]

  const handleSampleDownload = async () => {
    if (!resolvedCampaignId) return
    try {
      const response = await apiFetch(`/api/campaigns/${campaignApiPath(resolvedCampaignId)}/sample`)
      if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to download the sample CSV. Generating one locally instead.')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-sample.csv`
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)
      toast.success('Sample CSV downloaded')
    } catch (error) {
      console.error('Failed to download campaign sample CSV', error)
      downloadTextFile(
        `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-sample.csv`,
        buildSampleCsv(tableColumns)
      )
      toast.success('Generated sample CSV from this campaign schema')
    }
  }

  const handleImportLeads = async (file: File, scheduleDateTime?: string) => {
    if (!resolvedCampaignId) return

    try {
      const result = await importCampaignLeadsToApi(resolvedCampaignId, file, scheduleDateTime)
      toast.success(`Imported ${result.successCount} lead${result.successCount === 1 ? '' : 's'}`)
      await refreshDetail()
    } catch (error) {
      console.error('Campaign import failed', error)
      toast.error(getUserErrorMessage(error, 'Unable to import leads. Please check the CSV and try again.'))
    }
  }

  const handleRecreateCampaign = async (value: RetryCampaignFormValue) => {
    if (!resolvedCampaignId) return
    try {
      const created = await recreateCampaignToApi(resolvedCampaignId, value)
      toast.success('Retry campaign created')
      navigate(`/${adminSlug}/campaigns/${campaignApiPath(created.id)}/leads`)
    } catch (error) {
      console.error('Failed to recreate campaign', error)
      toast.error(getUserErrorMessage(error, 'Unable to create the retry campaign. Please try again.'))
      throw error
    }
  }

  return (
    <div className="w-full px-3 py-4">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/${adminSlug}/campaigns`)}>
            <ArrowLeft className="h-4 w-4" />
            Back to Campaigns
          </Button>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-950">{campaign.name}</h1>
            <span className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1', getStatusClasses(campaign.status))}>
              {getStatusLabel(campaign.status)}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {[campaign.clientName ?? campaign.companyName, campaign.languages?.join(', ')].filter(Boolean).join(' - ')}
          </p>
        </div>

        <div className="flex gap-2">
          {!isPostgresOnly ? (
            <>
              <Button type="button" variant="outline" onClick={() => setShowEditModal(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowRetryModal(true)}>
                <RotateCcw className="h-4 w-4" />
                Recreate
              </Button>
              <Button type="button" variant="outline" onClick={handleSampleDownload}>
                <CalendarClock className="h-4 w-4" />
                Sample CSV
              </Button>
              <Button type="button" onClick={() => setShowImportModal(true)}>
                <Upload className="h-4 w-4" />
                Import
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile icon={Target} label={isPostgresOnly || campaign.source === 'merged' ? 'Triggered' : 'Total leads'} value={formatNumber(total)} />
        <MetricTile icon={Clock3} label="Pending" value={formatNumber(metrics.pending)} />
        <MetricTile icon={CheckCircle2} label="Answered" value={formatNumber(getAnswered(metrics))} />
        <MetricTile icon={XCircle} label="Unanswered" value={formatNumber(metrics.unanswered ?? metrics.failed)} />
      </div>

      <div className="mt-6 space-y-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={campaignSearchInput}
            onChange={(event) => setCampaignSearchInput(event.target.value)}
            placeholder="Search leads, call logs, and analytics (e.g. promise to pay)..."
            className={cn('h-11 w-full bg-white pl-9', brandSearchInputClass)}
          />
        </label>
        <p className="text-xs text-slate-500">
          Batch ID: <span className="font-medium text-slate-700">{campaignBatchId(campaign)}</span>
          {campaignSearch.trim() ? ` · Filtering all tabs for “${campaignSearch.trim()}”` : ''}
        </p>
      </div>

      {resolvedCampaignId && adminSlug ? (
        <CampaignDetailNav adminSlug={adminSlug} campaignId={resolvedCampaignId} showInsights={showInsights} />
      ) : null}

      <Outlet context={outletContext ?? undefined} />

      <CampaignFormModal
        campaign={campaign}
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={async (value) => {
          await onSaveCampaign(value)
          setCampaignDetail((current) => formValueToCampaign(value, current ?? campaign))
        }}
      />

      <ImportLeadsModal
        campaign={campaign}
        columns={tableColumns}
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportLeads}
        onSampleDownload={handleSampleDownload}
      />

      <RetryCampaignModal
        campaign={campaign}
        leads={leads}
        open={showRetryModal}
        onClose={() => setShowRetryModal(false)}
        onCreate={handleRecreateCampaign}
      />
    </div>
  )
}

export default function Campaigns() {
  const location = useLocation()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [listDate, setListDate] = useState('')
  const [listAgent, setListAgent] = useState('')

  const fetchCampaigns = useCallback(async (filters?: { date?: string; agent?: string }) => {
    setLoading(true)
    try {
      const nextCampaigns = await readCampaignsFromApi({
        date: (filters?.date ?? listDate) || undefined,
        agent: (filters?.agent ?? listAgent) || undefined,
      })
      setCampaigns(nextCampaigns)
    } catch (error) {
      console.error('Failed to load campaigns', error)
      setCampaigns([])
      toast.error(getUserErrorMessage(error, 'Unable to load campaigns. Please refresh and try again.'))
    } finally {
      setLoading(false)
    }
  }, [listDate, listAgent])

  const handleListDateChange = useCallback((dateKey: string) => {
    setListDate(dateKey)
    void fetchCampaigns({ date: dateKey || undefined, agent: listAgent || undefined })
  }, [fetchCampaigns, listAgent])

  const handleListAgentChange = useCallback((agentId: string) => {
    setListAgent(agentId)
    void fetchCampaigns({ date: listDate || undefined, agent: agentId || undefined })
  }, [fetchCampaigns, listDate])

  useEffect(() => {
    void readAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [])

  const handleSaveCampaign = async (value: CampaignFormValue) => {
    const existing = campaigns.find((campaign) => campaign.id === value.id)
    try {
      const savedCampaign = await saveCampaignToApi(value)

      let finalCampaign = savedCampaign

      if (value.importFile) {
        try {
          const importResult = await importCampaignLeadsToApi(savedCampaign.id, value.importFile, value.scheduledAt)
          if (importResult.columnsSchema) {
            finalCampaign.columnsSchema = importResult.columnsSchema
          }
          if (importResult.postgresDumpSkipped) {
            toast.error(
              getUserErrorMessage(
                importResult.warning ? new Error(importResult.warning) : null,
                'Campaign created, but lead syncing is not fully configured. Please contact support.'
              )
            )
          } else {
            toast.success(`Imported ${importResult.successCount} lead${importResult.successCount === 1 ? '' : 's'}`)
          }
        } catch (error) {
          console.error("Failed to import leads on campaign creation", error)
          toast.error(`Campaign created, but lead import failed. ${getUserErrorMessage(error, 'Please check the CSV and try again.')}`)
        }
      }

      setCampaigns((current) => {
        const nextCampaign = formValueToCampaign({ ...value, id: finalCampaign.id, columnsSchema: finalCampaign.columnsSchema || value.columnsSchema }, { ...existing, ...finalCampaign })
        return current.some((campaign) => campaign.id === nextCampaign.id)
          ? current.map((campaign) => (campaign.id === nextCampaign.id ? nextCampaign : campaign))
          : [nextCampaign, ...current]
      })
      toast.success(value.id ? 'Campaign updated' : 'Campaign created')
    } catch (error) {
      console.error('Failed to save campaign', error)
      toast.error(getUserErrorMessage(error, 'Unable to save the campaign. Please try again.'))
      throw error
    }
  }

  useEffect(() => {
    const onCampaignsIndex = Boolean(matchPath({ path: '/:adminSlug/campaigns', end: true }, location.pathname))
    if (!onCampaignsIndex) {
      setLoading(false)
      return
    }
    void fetchCampaigns()
  }, [location.pathname, fetchCampaigns])

  return (
    <div className="min-h-screen bg-slate-50">
      <Routes>
        <Route
          index
          element={
            <CampaignsIndex
              campaigns={campaigns}
              loading={loading}
              listDate={listDate}
              listAgent={listAgent}
              agents={agents}
              onListDateChange={handleListDateChange}
              onListAgentChange={handleListAgentChange}
              onSaveCampaign={handleSaveCampaign}
            />
          }
        />
        <Route path=":campaignId" element={<CampaignDetailShell campaigns={campaigns} onSaveCampaign={handleSaveCampaign} />}>
          <Route index element={<Navigate to="leads" replace />} />
          <Route path="leads" element={<CampaignLeadsView />} />
          <Route path="logs" element={<CampaignLogsView />} />
          <Route path="analytics" element={<CampaignAnalyticsView />} />
        </Route>
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  )
}
