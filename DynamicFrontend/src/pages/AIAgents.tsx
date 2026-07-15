import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, AlertTriangle, ArrowLeft, Bell, CheckCircle2, CopyPlus, Gauge, ListChecks, MessageSquare, MoreVertical, Pencil, PhoneIncoming, PhoneOutgoing, Play, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'

import AgentPlayground from '../components/AIAgents/AgentPlayground'
import CallLogs from '../components/AIAgents/CallLogs'
import CallAnalytics from '../components/AIAgents/CallAnalytics'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiErrorFromResponse, apiFetch, getUserErrorMessage } from '@/lib/api'
import { canManageAgents, canUseAgentPlayground, canViewAgentInsights, canViewAgents, getDefaultAuthorizedPath } from '@/lib/roles'
import { useAuth } from '@/providers/AuthProvider'
import { brandSearchInputClass } from '@/lib/brandCss'
import { cn } from '@/lib/utils'

type Agent = {
  agent_id: string
  name: string
  type?: string
  description?: string
  callFlowText?: string
  generatedPrompt?: Record<string, unknown>
  uploadedScriptNames?: string[]
  status?: string
  useCase?: string
  gender?: string
  speechPace?: number
  personality?: string
  languages?: string[]
  channels?: string[]
  inboundSettings?: InboundCallSettings
  outboundSettings?: OutboundCallSettings
  launchNotifications?: LaunchNotificationSettings
  clientId?: string | null
}

type ClientOption = {
  id: string
  name: string
}

type AgentFormValue = {
  name: string
  description: string
  callFlowText: string
  generatedPrompt: string
  uploadedScriptNames: string[]
  useCase: string
  gender: string
  speechPace: number
  personality: string
  languages: string[]
  channels: string[]
  inboundSettings: InboundCallSettings
  outboundSettings: OutboundCallSettings
  launchNotifications: LaunchNotificationSettings
  clientId: string
  scriptFiles: File[]
}

type PromptSourceMode = 'description' | 'upload'
type InboundCallSettings = {
  didNumber: string
  maxConcurrentCalls: number
  queueWaitLimitSec: number
  maxCallDuration: string
  offHoursBehavior: string
  ivrFallback: string
  postCallSmsFollowUp: boolean
  callbackScheduling: boolean
}
type OutboundCallSettings = {
  rotationStrategy: string
  rotateAfterEvery: string
  dialingMode: string
  callsPerMinute: number
  maxCallDuration: string
  ringTimeoutSec: number
  maxRetriesPerContact: number
  retryInterval: string
  dailyCallLimitPerContact: number
  totalCampaignCallCap: number
  callingWindowStart: string
  callingWindowEnd: string
  timezone: string
  campaignStartDate: string
  campaignEndDate: string
  activeDays: string
  pauseCampaignOn: string
  dncScrubbing: boolean
  voicemailDetectionDrop: boolean
  callRecording: boolean
  realtimeSentimentMonitoring: boolean
  humanHandoffTrigger: boolean
}
type LaunchNotificationSettings = {
  lowConnectRateAlert: boolean
  highEscalationAlert: boolean
  campaignCompletion: boolean
  dailySummaryEmail: boolean
}
type ReviewChecklistItem = {
  title: string
  detail: string
  passed: boolean
  warning?: boolean
}

const USE_CASES = ['Customer Support', 'Sales', 'Survey', 'Onboarding', 'Notifications', 'Collections'] as const
const GENDERS = ['Male', 'Female', 'Neutral'] as const
const AGENT_NAME_MAX_LENGTH = 25
const AGENT_DESCRIPTION_MAX_LENGTH = 50
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
] as const
const PERSONALITIES = [
  { name: 'Friendly', description: 'Warm, approachable, and easy to talk to.' },
  { name: 'Professional', description: 'Structured and businesslike for formal conversations.' },
  { name: 'Empathetic', description: 'Supportive and calm for sensitive customer interactions.' },
  { name: 'Custom', description: 'Flexible baseline for bespoke agent instructions later.' },
] as const
const CALL_MODES = [
  {
    name: 'Inbound Call',
    description: 'Handle incoming calls from users who reach out to your agent.',
    support: 'supported',
    icon: 'inbound' as const,
    color: 'bg-sky-500',
  },
  {
    name: 'Outbound Call',
    description: 'Place outgoing calls for reminders, onboarding, support, or campaign workflows.',
    support: 'supported',
    icon: 'outbound' as const,
    color: 'bg-emerald-500',
  },
] as const
const INBOUND_DID_OPTIONS = ['+91 80 4567 8900', '+91 22 4567 1200', '+91 11 4567 3400'] as const
const MAX_CALL_DURATION_OPTIONS = ['5 min', '10 min', '15 min', '30 min'] as const
const OFF_HOURS_OPTIONS = ['Play voicemail message', 'Forward to fallback number', 'End call politely'] as const
const IVR_FALLBACK_OPTIONS = ['Enabled - 3 options', 'Enabled - 2 options', 'Disabled'] as const
const ROTATION_STRATEGY_OPTIONS = ['Round robin', 'Sticky agent', 'Least busy'] as const
const ROTATE_AFTER_OPTIONS = ['1 call', '5 calls', '10 calls'] as const
const DIALING_MODE_OPTIONS = ['Predictive', 'Progressive', 'Preview'] as const
const RETRY_INTERVAL_OPTIONS = ['30 min', '1 hour', '2 hours', '4 hours', '1 day'] as const
const TIMEZONE_OPTIONS = ['Auto-detect (customer)', 'Asia/Kolkata', 'UTC'] as const
const ACTIVE_DAYS_OPTIONS = ['Mon-Sat', 'Mon-Fri', 'All days'] as const
const PAUSE_CAMPAIGN_OPTIONS = ['Public holidays', 'No pause', 'Weekends'] as const
const DEFAULT_INBOUND_SETTINGS: InboundCallSettings = {
  didNumber: INBOUND_DID_OPTIONS[0],
  maxConcurrentCalls: 50,
  queueWaitLimitSec: 60,
  maxCallDuration: '10 min',
  offHoursBehavior: OFF_HOURS_OPTIONS[0],
  ivrFallback: IVR_FALLBACK_OPTIONS[0],
  postCallSmsFollowUp: true,
  callbackScheduling: false,
}
const DEFAULT_OUTBOUND_SETTINGS: OutboundCallSettings = {
  rotationStrategy: ROTATION_STRATEGY_OPTIONS[0],
  rotateAfterEvery: ROTATE_AFTER_OPTIONS[0],
  dialingMode: DIALING_MODE_OPTIONS[0],
  callsPerMinute: 30,
  maxCallDuration: '5 min',
  ringTimeoutSec: 30,
  maxRetriesPerContact: 3,
  retryInterval: '2 hours',
  dailyCallLimitPerContact: 2,
  totalCampaignCallCap: 5000,
  callingWindowStart: '09:00',
  callingWindowEnd: '20:00',
  timezone: TIMEZONE_OPTIONS[0],
  campaignStartDate: '',
  campaignEndDate: '',
  activeDays: ACTIVE_DAYS_OPTIONS[0],
  pauseCampaignOn: PAUSE_CAMPAIGN_OPTIONS[0],
  dncScrubbing: true,
  voicemailDetectionDrop: true,
  callRecording: true,
  realtimeSentimentMonitoring: false,
  humanHandoffTrigger: true,
}
const OUTBOUND_COMPLIANCE_OPTIONS: Array<{
  key: 'dncScrubbing' | 'voicemailDetectionDrop' | 'callRecording' | 'realtimeSentimentMonitoring' | 'humanHandoffTrigger'
  title: string
  description: string
}> = [
    {
      key: 'dncScrubbing',
      title: 'DNC (Do Not Call) Scrubbing',
      description: 'Automatically skip contacts on DNC registry before dialing.',
    },
    {
      key: 'voicemailDetectionDrop',
      title: 'Voicemail Detection & Drop',
      description: 'Detect answering machines and leave a pre-recorded voicemail.',
    },
    {
      key: 'callRecording',
      title: 'Call Recording',
      description: 'Record all outbound calls for QA and compliance.',
    },
    {
      key: 'realtimeSentimentMonitoring',
      title: 'Real-time Sentiment Monitoring',
      description: 'Flag calls with negative sentiment for supervisor review.',
    },
    {
      key: 'humanHandoffTrigger',
      title: 'Human Handoff Trigger',
      description: 'Transfer to live agent if customer escalates or expresses distress.',
    },
  ]
const DEFAULT_LAUNCH_NOTIFICATIONS: LaunchNotificationSettings = {
  lowConnectRateAlert: true,
  highEscalationAlert: true,
  campaignCompletion: true,
  dailySummaryEmail: true,
}
const IS_DEVELOPMENT = import.meta.env.DEV

async function readAgents() {
  const response = await apiFetch('/api/agents')
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load agents. Please refresh and try again.')
  const result = (await response.json()) as { success?: boolean; data?: Agent[] }
  if (result.success && Array.isArray(result.data)) return result.data
  throw new Error('Agents API response did not include data')
}

async function readClients() {
  const response = await apiFetch('/api/campaigns/clients')
  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load clients. Please refresh and try again.')
  const result = (await response.json()) as { success?: boolean; data?: ClientOption[] }
  if (result.success && Array.isArray(result.data)) return result.data
  throw new Error('Clients API response did not include data')
}

function agentSearchText(agent: Agent) {
  return [agent.name, agent.type, agent.description, agent.useCase, agent.agent_id, agent.status, ...(agent.languages ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
}

function matchesAgentSearch(agent: Agent, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = agentSearchText(agent)
  return tokens.every((token) => haystack.includes(token.replace(/[_-]+/g, ' ')))
}

function formatGeneratedPrompt(value?: Record<string, unknown> | null) {
  return value ? JSON.stringify(value, null, 2) : ''
}

function parseGeneratedPrompt(value: string) {
  const parsed = JSON.parse(value) as unknown
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  throw new Error('Generated call flow must be a JSON object')
}

function getSystemPrompt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const direct = record.system_prompt
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>
  const nestedData = record.data
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    const nestedPrompt = (nestedData as Record<string, unknown>).system_prompt
    if (nestedPrompt && typeof nestedPrompt === 'object' && !Array.isArray(nestedPrompt)) return nestedPrompt as Record<string, unknown>
  }
  return null
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function clampAgentName(value: string) {
  return value.trim().slice(0, AGENT_NAME_MAX_LENGTH)
}

function fileNameToAgentName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const cleaned = titleCase(baseName)
  return clampAgentName(cleaned ? `${cleaned} Agent` : 'Development Agent')
}

function getFirstString(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function clampDescription(value: string) {
  return value.trim().slice(0, AGENT_DESCRIPTION_MAX_LENGTH)
}

async function generateCallFlowDraft(value: AgentFormValue, sourceMode: PromptSourceMode) {
  const formData = new FormData()
  if (sourceMode === 'description') {
    formData.append('callFlowText', value.callFlowText)
  } else {
    for (const file of value.scriptFiles) {
      formData.append('scriptFiles', file)
    }
  }

  const response = await apiFetch('/api/agents/generate-call-flow', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(response, 'Call flow generation is temporarily unavailable. Please try again in a few minutes.')
  }

  const result = (await response.json().catch(() => null)) as {
    success?: boolean
    data?: {
      generatedPrompt?: Record<string, unknown>
      callFlowText?: string
      uploadedScriptNames?: string[]
    }
    error?: string
    code?: string
  } | null

  if (!result?.success || !result.data?.generatedPrompt) {
    throw new Error('Call flow generation finished without a usable response. Please try again.')
  }

  return result.data
}

async function saveAgent(value: AgentFormValue, agentId?: string) {
  const formData = new FormData()
  formData.append('name', value.name)
  formData.append('description', value.description)
  formData.append('callFlowText', value.callFlowText)
  formData.append('generatedPrompt', value.generatedPrompt)
  formData.append('uploadedScriptNames', JSON.stringify(value.uploadedScriptNames))
  formData.append('useCase', value.useCase)
  formData.append('gender', value.gender)
  formData.append('speechPace', String(value.speechPace))
  formData.append('personality', value.personality)
  formData.append('languages', JSON.stringify(value.languages))
  formData.append('channels', JSON.stringify(value.channels))
  formData.append('inboundSettings', JSON.stringify(value.inboundSettings))
  formData.append('outboundSettings', JSON.stringify(value.outboundSettings))
  formData.append('launchNotifications', JSON.stringify(value.launchNotifications))
  formData.append('clientId', value.clientId || '')
  if (!value.generatedPrompt.trim()) {
    for (const file of value.scriptFiles) {
      formData.append('scriptFiles', file)
    }
  }

  const response = await apiFetch(agentId ? `/api/agents/${agentId}` : '/api/agents', {
    method: agentId ? 'PUT' : 'POST',
    body: formData,
  })

  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to save the agent. Please try again.')

  const result = (await response.json().catch(() => null)) as { success?: boolean; data?: Agent; error?: string } | null
  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'Unable to save the agent. Please try again.')
  }

  return result.data
}

async function deleteAgent(agentId: string) {
  const response = await apiFetch(`/api/agents/${agentId}`, {
    method: 'DELETE',
  })

  if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to delete the agent. Please try again.')

  const result = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
  if (!result?.success) {
    throw new Error(result?.error ?? 'Unable to delete the agent. Please try again.')
  }
}

function defaultAgentForm(agent?: Agent): AgentFormValue {
  const normalizedChannels = agent?.channels?.length
    ? agent.channels.flatMap((channel) => (channel === 'Call' ? ['Inbound Call', 'Outbound Call'] : [channel]))
    : ['Outbound Call']
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    callFlowText: agent?.callFlowText ?? '',
    generatedPrompt: formatGeneratedPrompt(agent?.generatedPrompt),
    uploadedScriptNames: agent?.uploadedScriptNames ?? [],
    useCase: agent?.useCase ?? '',
    gender: agent?.gender ?? 'Neutral',
    speechPace: agent?.speechPace ?? 1,
    personality: agent?.personality ?? 'Custom',
    languages: agent?.languages?.length ? agent.languages : ['English'],
    channels: [...new Set(normalizedChannels)],
    inboundSettings: { ...DEFAULT_INBOUND_SETTINGS, ...(agent?.inboundSettings ?? {}) },
    outboundSettings: { ...DEFAULT_OUTBOUND_SETTINGS, ...(agent?.outboundSettings ?? {}) },
    launchNotifications: { ...DEFAULT_LAUNCH_NOTIFICATIONS, ...(agent?.launchNotifications ?? {}) },
    clientId: agent?.clientId ?? '',
    scriptFiles: [],
  }
}

function readGeneratedPromptSummary(value: string) {
  try {
    const parsed = parseGeneratedPrompt(value)
    const text = JSON.stringify(parsed).toLowerCase()
    const nodeMatches = text.match(/"step"|"node"|"id"/g)
    const branchMatches = text.match(/branch|condition|fallback|if_/g)
    const isDevelopment = Boolean((parsed as Record<string, unknown>).development_placeholder)
    return {
      isValid: true,
      nodes: Math.max(1, Math.min(nodeMatches?.length ?? 1, 99)),
      branches: Math.min(branchMatches?.length ?? 0, 99),
      source: isDevelopment ? 'Dev placeholder' : 'AI-generated',
    }
  } catch {
    return {
      isValid: false,
      nodes: 0,
      branches: 0,
      source: 'Not generated',
    }
  }
}

function buildLaunchReview(form: AgentFormValue) {
  const hasInbound = form.channels.includes('Inbound Call')
  const hasOutbound = form.channels.includes('Outbound Call')
  const promptSummary = readGeneratedPromptSummary(form.generatedPrompt)
  const hasCoreConfig = Boolean(form.name.trim() && form.useCase.trim() && form.description.trim() && form.languages.length && form.gender.trim())
  const hasCallChannels = form.channels.length > 0
  const hasOutboundWindow = Boolean(form.outboundSettings.callingWindowStart && form.outboundSettings.callingWindowEnd && form.outboundSettings.timezone)
  const hasInboundRouting = Boolean(form.inboundSettings.didNumber && form.inboundSettings.ivrFallback)

  const checklist: ReviewChecklistItem[] = [
    {
      title: 'Agent name and use case set',
      detail: `${form.name || 'Not set'} - ${form.useCase || 'No use case'}`,
      passed: Boolean(form.name.trim() && form.useCase.trim()),
    },
    {
      title: 'Voice, language and pace configured',
      detail: `${form.gender || 'No voice'} - ${form.languages.length ? form.languages.join(', ') : 'No languages'} - ${form.speechPace.toFixed(2).replace(/\.00$/, '.0')}x`,
      passed: Boolean(form.gender.trim() && form.languages.length),
    },
    {
      title: 'Agent card description set',
      detail: form.description.trim() || 'Description is empty',
      passed: Boolean(form.description.trim()),
    },
    {
      title: 'Call flow generated and saved',
      detail: promptSummary.isValid
        ? `${promptSummary.nodes} nodes - ${promptSummary.branches} branches - ${promptSummary.source}`
        : 'Generate or repair call-flow JSON before launch',
      passed: promptSummary.isValid,
      warning: !promptSummary.isValid,
    },
  ]

  if (hasInbound) {
    checklist.push(
      {
        title: 'Inbound number and IVR configured',
        detail: `${form.inboundSettings.didNumber} - ${form.inboundSettings.ivrFallback}`,
        passed: hasInboundRouting,
      },
      {
        title: 'Inbound queue protection set',
        detail: `${form.inboundSettings.maxConcurrentCalls} concurrent - ${form.inboundSettings.queueWaitLimitSec}s wait limit`,
        passed: form.inboundSettings.maxConcurrentCalls > 0,
      },
    )
  }

  if (hasOutbound) {
    checklist.push(
      {
        title: 'Caller rotation and pacing assigned',
        detail: `${form.outboundSettings.rotationStrategy} - ${form.outboundSettings.callsPerMinute} CPM`,
        passed: form.outboundSettings.callsPerMinute > 0,
      },
      {
        title: 'Calling window and timezone set',
        detail: `${form.outboundSettings.callingWindowStart}-${form.outboundSettings.callingWindowEnd} - ${form.outboundSettings.timezone} - ${form.outboundSettings.activeDays}`,
        passed: hasOutboundWindow,
      },
      {
        title: 'DNC scrubbing enabled',
        detail: form.outboundSettings.dncScrubbing ? 'Contacts screened before each dial' : 'DNC screening is disabled',
        passed: form.outboundSettings.dncScrubbing,
        warning: !form.outboundSettings.dncScrubbing,
      },
      {
        title: 'Call recording active',
        detail: form.outboundSettings.callRecording ? 'All calls recorded for QA and compliance' : 'Recording is disabled',
        passed: form.outboundSettings.callRecording,
        warning: !form.outboundSettings.callRecording,
      },
      {
        title: 'Human handoff configured',
        detail: form.outboundSettings.humanHandoffTrigger ? 'Escalation transfers to live agent' : 'No live-agent escalation trigger',
        passed: form.outboundSettings.humanHandoffTrigger,
        warning: !form.outboundSettings.humanHandoffTrigger,
      },
    )
  }

  checklist.push({
    title: 'Playground test pending',
    detail: 'Run a quick scenario from the agent card after saving',
    passed: false,
    warning: true,
  })

  const passed = checklist.filter((item) => item.passed).length
  const warnings = checklist.filter((item) => item.warning && !item.passed).length
  const readinessScore = Math.round((passed / checklist.length) * 100)
  const configurationScore = hasCoreConfig && hasCallChannels ? 100 : hasCoreConfig || hasCallChannels ? 60 : 25
  const callFlowScore = promptSummary.isValid ? (promptSummary.source === 'Dev placeholder' ? 75 : 100) : 0
  const complianceScore = hasOutbound
    ? Math.round(
      ([form.outboundSettings.dncScrubbing, form.outboundSettings.callRecording, form.outboundSettings.humanHandoffTrigger].filter(Boolean).length / 3) * 100
    )
    : 100
  const testingScore = checklist.some((item) => item.title === 'Playground test pending' && !item.passed) ? 50 : 100
  const estimatedCallsPerDay = hasOutbound
    ? Math.min(form.outboundSettings.totalCampaignCallCap, form.outboundSettings.callsPerMinute * 60 * 4)
    : form.inboundSettings.maxConcurrentCalls * 80
  const estimatedDurationHours = Math.max(0.5, Math.round(((estimatedCallsPerDay * 8.4) / 3600) * 10) / 10)
  const campaignDays = hasOutbound ? Math.max(1, Math.ceil(form.outboundSettings.totalCampaignCallCap / Math.max(estimatedCallsPerDay, 1))) : null

  return {
    checklist,
    passed,
    warnings,
    readinessScore,
    scoreSections: [
      { label: 'Configuration', value: configurationScore },
      { label: 'Call flow', value: callFlowScore },
      { label: 'Compliance', value: complianceScore },
      { label: 'Testing', value: testingScore },
    ],
    estimatedLoad: {
      contacts: hasOutbound ? '2,400' : 'Inbound demand',
      callsPerDay: hasOutbound ? `~${estimatedCallsPerDay.toLocaleString()}` : `~${estimatedCallsPerDay.toLocaleString()}`,
      durationPerDay: `~${estimatedDurationHours.toFixed(1)} hrs`,
      campaignEnd: campaignDays ? `~${campaignDays} days` : 'Ongoing',
      capRemaining: hasOutbound ? form.outboundSettings.totalCampaignCallCap.toLocaleString() : 'No campaign cap',
    },
  }
}

function statusTone(status?: string) {
  const normalized = status?.toLowerCase() ?? 'active'
  if (normalized === 'active') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (normalized === 'paused') return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-slate-100 text-slate-700 ring-slate-200'
}

function useCaseAccent(useCase?: string) {
  switch (useCase) {
    case 'Customer Support':
      return 'from-emerald-50 to-emerald-100/70'
    case 'Sales':
      return 'from-fuchsia-50 to-fuchsia-100/70'
    case 'Survey':
      return 'from-amber-50 to-orange-100/70'
    case 'Onboarding':
      return 'from-sky-50 to-indigo-100/70'
    case 'Notifications':
      return 'from-blue-50 to-cyan-100/70'
    case 'Collections':
      return 'from-teal-50 to-emerald-100/70'
    default:
      return 'from-slate-50 to-slate-100/80'
  }
}

function CreateAgentCard({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.98 }}
      onClick={onCreate}
      className="group block h-full w-full text-left"
    >
      <Card className="relative flex h-full min-h-[220px] overflow-hidden rounded-[24px] border border-sky-100 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_42%),linear-gradient(165deg,_#f8fbff_0%,_#eef4ff_100%)] shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:border-sky-300 group-hover:shadow-xl">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(140deg,transparent_0%,rgba(255,255,255,0.72)_45%,transparent_100%)] opacity-80" />
        <CardContent className="relative flex flex-1 flex-col justify-between p-5">
          <div className="space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 shadow-sm ring-1 ring-sky-200">
              <Plus className="h-6 w-6" />
            </div>
            <div className="space-y-2.5">
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-950">Create New Agent</h2>
              <p className="max-w-sm text-sm leading-6 text-slate-600">Build a new AI agent with a use case and a call channel.</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div />
            <span className="inline-flex items-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
              Get Started
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.button>
  )
}

function AgentCard({
  agent,
  showPlayground,
  canEdit,
  onPlayground,
  onEdit,
  onClone,
  onDelete,
}: {
  agent: Agent
  showPlayground: boolean
  canEdit: boolean
  onPlayground: (id: string) => void
  onEdit: (id: string) => void
  onClone: (agent: Agent) => void
  onDelete: (id: string) => void
}) {
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActionsOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsMenuRef.current?.contains(event.target)) {
        setIsActionsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsActionsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActionsOpen])

  const handleClone = () => {
    setIsActionsOpen(false)
    onClone(agent)
  }
  const handleEdit = () => {
    setIsActionsOpen(false)
    onEdit(agent.agent_id)
  }
  const handleDelete = () => {
    setIsActionsOpen(false)
    onDelete(agent.agent_id)
  }
  const callModeTags = agent.channels?.length
    ? agent.channels.flatMap((channel) => (channel === 'Call' ? ['Inbound Call', 'Outbound Call'] : [channel]))
    : ['Outbound Call']

  return (
    <motion.div
      className="group relative w-full"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[26px] opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100',
          'bg-gradient-to-r',
          useCaseAccent(agent.useCase)
        )}
      />
      <Card className="relative flex h-[318px] flex-col overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-sm transition-all duration-300 group-hover:border-slate-300 group-hover:shadow-lg">
        <div className={cn('h-1 w-full bg-gradient-to-r', useCaseAccent(agent.useCase))} />
        <CardHeader className="space-y-0 p-5 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="truncate text-[1.45rem] leading-none tracking-tight text-slate-950">{agent.name}</CardTitle>
            </div>
            {canEdit ? (
              <div className="relative shrink-0" ref={actionsMenuRef}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 rounded-md p-0 text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  onClick={() => setIsActionsOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={isActionsOpen}
                  aria-label={`Open actions for ${agent.name}`}
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
                {isActionsOpen ? (
                  <div
                    className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-950/10"
                    role="menu"
                    aria-label={`${agent.name} actions`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                      onClick={handleClone}
                      role="menuitem"
                    >
                      <CopyPlus className="h-4 w-4" />
                      Clone Agent
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                      onClick={handleEdit}
                      role="menuitem"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={handleDelete}
                      role="menuitem"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col px-5 pb-5 pt-0">
          <p className="line-clamp-2 overflow-hidden text-sm leading-6 text-slate-600">
            {agent.description || 'No description provided yet.'}
          </p>
          <div className="mt-auto flex w-full flex-wrap items-center gap-2">
            <span className={cn('inline-flex min-w-[6.5rem] flex-1 items-center justify-center rounded-md px-3 py-1 text-sm font-semibold capitalize ring-1', statusTone(agent.status))}>
              <span className="truncate text-center">{agent.status ?? 'active'}</span>
            </span>
            {[...new Set(callModeTags)].map((channel) => (
              <span key={channel} className="inline-flex min-w-[8rem] flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
                {channel === 'Inbound Call' ? <PhoneIncoming className="h-4 w-4 shrink-0 text-slate-500" /> : <PhoneOutgoing className="h-4 w-4 shrink-0 text-slate-500" />}
                <span className="truncate text-center">{channel.replace(' Call', '')}</span>
              </span>
            ))}
            {agent.useCase ? (
              <span className="inline-flex min-w-[9rem] flex-1 items-center justify-center rounded-md bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700 ring-1 ring-sky-100">
                <span className="truncate text-center">{agent.useCase}</span>
              </span>
            ) : null}
          </div>
          {showPlayground ? (
            <div className="mt-1 border-t border-slate-100 pt-2">
              <Button
                className="h-10 w-full justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
                type="button"
                onClick={() => onPlayground(agent.agent_id)}
              >
                <Play className="h-4 w-4" />
                Open Playground
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function CloneAgentModal({
  agent,
  name,
  saving,
  onNameChange,
  onClose,
  onConfirm,
}: {
  agent: Agent
  name: string
  saving: boolean
  onNameChange: (name: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <Card className="w-full max-w-md rounded-2xl border-slate-200 bg-white shadow-2xl">
        <CardHeader className="space-y-2 p-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold text-slate-950">Clone Agent</CardTitle>
              <CardDescription>Copy "{agent.name}" with a new agent name.</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving} aria-label="Close clone dialog">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-6 pb-6">
          <Label htmlFor="clone-agent-name">New agent name</Label>
          <Input
            id="clone-agent-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Enter a different name"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') onConfirm()
            }}
          />
        </CardContent>
        <CardFooter className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? 'Cloning...' : 'Clone Agent'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

function AgentWizard({
  mode,
  initialValue,
  clients,
  loadingClients,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initialValue: AgentFormValue
  clients: ClientOption[]
  loadingClients: boolean
  onSubmit: (value: AgentFormValue) => Promise<void>
  onCancel: () => void
}) {
  const { user } = useAuth()
  const isIifl = user?.adminSlug === 'iiflsamasta' || user?.email === 'admin@iiflsamasta.local'
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [generatingCallFlow, setGeneratingCallFlow] = useState(false)
  const [form, setForm] = useState(initialValue)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dragActive, setDragActive] = useState(false)
  const [promptSourceMode, setPromptSourceMode] = useState<PromptSourceMode>('description')

  useEffect(() => {
    setForm(initialValue)
    setPromptSourceMode('description')
  }, [initialValue])

  const steps = ['Call Flow', 'General Info', 'Review']

  const applyGeneratedPromptHints = (generatedPrompt: Record<string, unknown>) => {
    const systemPrompt = getSystemPrompt(generatedPrompt)
    const identity = systemPrompt?.identity
    const langSettings = systemPrompt?.language_settings
    const promptDescription =
      getFirstString(systemPrompt, ['agent_description', 'description', 'summary', 'purpose', 'objective']) ||
      getFirstString(generatedPrompt, ['agent_description', 'description', 'summary', 'purpose', 'objective'])

    setForm(current => {
      const updated = { ...current }
      if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
        const identityRecord = identity as Record<string, unknown>
        if (typeof identityRecord.name === 'string' && identityRecord.name.trim() && !updated.name.trim()) {
          updated.name = clampAgentName(identityRecord.name)
        }
        const generatedGender = identityRecord.gender
        if (typeof generatedGender === 'string') {
          const mappedGender = GENDERS.find(g => g.toLowerCase() === generatedGender.toLowerCase()) || 'Neutral'
          updated.gender = mappedGender
        }
        const generatedRole = identityRecord.role
        if (typeof generatedRole === 'string') {
          const role = generatedRole.toLowerCase()
          const mappedUseCase = USE_CASES.find(u => {
            const useCase = u.toLowerCase()
            return useCase.includes(role) || role.includes(useCase) || (useCase === 'customer support' && role.includes('support'))
          })
          if (mappedUseCase && !updated.useCase.trim()) {
            updated.useCase = mappedUseCase
          }
          if (!updated.description.trim() && !promptDescription.trim()) {
            updated.description = clampDescription(`Handles ${generatedRole.trim().toLowerCase()} conversations based on the uploaded call flow.`)
          }
        }
      }
      if (promptDescription && !updated.description.trim()) {
        updated.description = clampDescription(promptDescription)
      }
      if (langSettings && typeof langSettings === 'object' && !Array.isArray(langSettings)) {
        const supported = (langSettings as Record<string, unknown>).supported
        if (Array.isArray(supported) && supported.length > 0) {
          const mappedLangs = supported
            .map(l => LANGUAGE_OPTIONS.find(opt => opt.toLowerCase() === String(l).toLowerCase()))
            .filter((l): l is typeof LANGUAGE_OPTIONS[number] => !!l)
          if (mappedLangs.length > 0) {
            updated.languages = mappedLangs
          }
        }
      }
      return updated
    })
  }

  const handleGenerateCallFlow = async () => {
    const nextErrors: Record<string, string> = {}
    if (promptSourceMode === 'description' && !form.callFlowText.trim()) {
      nextErrors.callFlowText = 'Call flow description is required'
    }
    if (promptSourceMode === 'upload' && form.scriptFiles.length === 0) {
      nextErrors.scriptFiles = 'Upload at least one script file'
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setGeneratingCallFlow(true)
    const toastId = toast.loading('Generating call flow...')
    try {
      const result = await generateCallFlowDraft(form, promptSourceMode)
      const generatedPrompt = result.generatedPrompt
      if (!generatedPrompt) throw new Error('Call flow API did not return a generated prompt')
      setForm(current => ({
        ...current,
        callFlowText: result.callFlowText ?? current.callFlowText,
        generatedPrompt: formatGeneratedPrompt(generatedPrompt),
        uploadedScriptNames: result.uploadedScriptNames ?? current.uploadedScriptNames,
      }))
      setErrors((current) => ({ ...current, callFlowText: '', scriptFiles: '', generatedPrompt: '' }))
      applyGeneratedPromptHints(generatedPrompt)
      toast.success('Call flow generated. Review and edit it before continuing.', { id: toastId })
    } catch (err) {
      console.error(err)
      const message = getUserErrorMessage(err, 'Call flow generation is temporarily unavailable. Please try again in a few minutes.')
      setErrors((current) => ({ ...current, generatedPrompt: message }))
      toast.error('Call flow could not be generated. Please try again.', { id: toastId })
    } finally {
      setGeneratingCallFlow(false)
    }
  }

  const handleUseDevelopmentCallFlow = () => {
    const uploadedScriptNames = form.scriptFiles.map((file) => file.name)
    const inferredName = clampAgentName(form.name.trim() || (uploadedScriptNames[0] ? fileNameToAgentName(uploadedScriptNames[0]) : 'Development Agent'))
    const inferredUseCase = form.useCase.trim() || 'Customer Support'
    const inferredDescription = clampDescription(
      form.description.trim() ||
      (uploadedScriptNames.length
        ? `Development call-flow placeholder generated from ${uploadedScriptNames.join(', ')}.`
        : 'Development call-flow placeholder for local agent setup.')
    )
    const sourceSummary =
      form.callFlowText.trim() ||
      (uploadedScriptNames.length ? `Uploaded development files: ${uploadedScriptNames.join(', ')}` : 'Development placeholder call flow')
    const generatedPrompt = {
      system_prompt: {
        identity: {
          name: inferredName,
          role: inferredUseCase,
          gender: form.gender || 'Neutral',
        },
        description: inferredDescription,
        language_settings: {
          supported: form.languages.length ? form.languages : ['English'],
        },
        call_flow: [
          {
            step: 'development_placeholder',
            instruction: 'Placeholder call flow for local development. Replace by submitting to the prompt generator before production use.',
          },
        ],
        source: sourceSummary,
      },
      development_placeholder: true,
    }

    setForm((current) => ({
      ...current,
      name: clampAgentName(current.name.trim() || inferredName),
      description: current.description.trim() || inferredDescription,
      useCase: current.useCase.trim() || inferredUseCase,
      gender: current.gender || 'Neutral',
      languages: current.languages.length ? current.languages : ['English'],
      callFlowText: current.callFlowText.trim() || sourceSummary,
      generatedPrompt: formatGeneratedPrompt(generatedPrompt),
      uploadedScriptNames,
    }))
    setErrors((current) => ({ ...current, callFlowText: '', scriptFiles: '', generatedPrompt: '' }))
    toast.info('Development placeholder call flow added.')
  }

  const validateStep = () => {
    const nextErrors: Record<string, string> = {}

    if (step === 0) {
      const hasGeneratedPrompt = form.generatedPrompt.trim().length > 0
      if (!hasGeneratedPrompt && promptSourceMode === 'description' && !form.callFlowText.trim()) nextErrors.callFlowText = 'Call flow description is required'
      if (!hasGeneratedPrompt && promptSourceMode === 'upload' && form.scriptFiles.length === 0) nextErrors.scriptFiles = 'Upload at least one script file'
      if (!form.generatedPrompt.trim()) {
        nextErrors.generatedPrompt = 'Submit the call flow before continuing'
      } else {
        try {
          parseGeneratedPrompt(form.generatedPrompt)
        } catch (error) {
          nextErrors.generatedPrompt = 'Generated call flow must be valid JSON'
        }
      }
    }

    if (step === 1) {
      if (!form.name.trim()) nextErrors.name = 'Agent name is required'
      if (form.name.trim().length > AGENT_NAME_MAX_LENGTH) nextErrors.name = `Agent name must be ${AGENT_NAME_MAX_LENGTH} characters or less`
      if (!form.description.trim()) nextErrors.description = 'Agent description is required'
      if (form.description.trim().length > AGENT_DESCRIPTION_MAX_LENGTH) nextErrors.description = `Description must be ${AGENT_DESCRIPTION_MAX_LENGTH} characters or less`
      if (!form.useCase.trim()) nextErrors.useCase = 'Use case is required'
      if (!form.gender.trim()) nextErrors.gender = 'Gender is required'
      if (form.languages.length === 0) nextErrors.languages = 'Select at least one language'
    }

    if (step === 2 && form.channels.length === 0) {
      nextErrors.channels = 'Select at least one call mode'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleNext = () => {
    if (!validateStep()) return
    setStep((current) => Math.min(current + 1, steps.length - 1))
  }

  const handleSave = async () => {
    const nextErrors: Record<string, string> = {}
    if (!form.name.trim()) nextErrors.name = 'Agent name is required'
    if (form.name.trim().length > AGENT_NAME_MAX_LENGTH) nextErrors.name = `Agent name must be ${AGENT_NAME_MAX_LENGTH} characters or less`
    if (!form.description.trim()) nextErrors.description = 'Agent description is required'
    if (!form.useCase.trim()) nextErrors.useCase = 'Use case is required'
    if (!form.gender.trim()) nextErrors.gender = 'Gender is required'
    if (form.languages.length === 0) nextErrors.languages = 'Select at least one language'
    if (form.channels.length === 0) nextErrors.channels = 'Select at least one call mode'
    if (form.description.trim().length > AGENT_DESCRIPTION_MAX_LENGTH) nextErrors.description = `Description must be ${AGENT_DESCRIPTION_MAX_LENGTH} characters or less`
    const hasGeneratedPrompt = form.generatedPrompt.trim().length > 0
    if (!hasGeneratedPrompt && promptSourceMode === 'description' && !form.callFlowText.trim()) nextErrors.callFlowText = 'Call flow description is required'
    if (!hasGeneratedPrompt && promptSourceMode === 'upload' && form.scriptFiles.length === 0) nextErrors.scriptFiles = 'Upload at least one script file'
    if (!form.generatedPrompt.trim()) {
      nextErrors.generatedPrompt = 'Submit the call flow before saving'
    } else {
      try {
        parseGeneratedPrompt(form.generatedPrompt)
      } catch (error) {
        nextErrors.generatedPrompt = 'Generated call flow must be valid JSON'
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      if (nextErrors.callFlowText || nextErrors.scriptFiles || nextErrors.generatedPrompt) setStep(0)
      else if (nextErrors.name || nextErrors.description || nextErrors.useCase || nextErrors.gender || nextErrors.languages) setStep(1)
      else if (nextErrors.channels) setStep(2)
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        callFlowText: form.callFlowText.trim(),
        generatedPrompt: form.generatedPrompt.trim(),
      })
    } catch (error) {
      console.error('Failed to save agent', error)
      toast.error(getUserErrorMessage(error, mode === 'create' ? 'Unable to create the agent. Please try again.' : 'Unable to update the agent. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const toggleChannel = (channel: string) => {
    setForm((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel],
    }))
    setErrors((current) => ({ ...current, channels: '' }))
  }

  const updateInboundSetting = <K extends keyof InboundCallSettings>(key: K, value: InboundCallSettings[K]) => {
    setForm((current) => ({
      ...current,
      inboundSettings: {
        ...current.inboundSettings,
        [key]: value,
      },
    }))
  }

  const updateOutboundSetting = <K extends keyof OutboundCallSettings>(key: K, value: OutboundCallSettings[K]) => {
    setForm((current) => ({
      ...current,
      outboundSettings: {
        ...current.outboundSettings,
        [key]: value,
      },
    }))
  }

  const toggleLaunchNotification = (key: keyof LaunchNotificationSettings) => {
    setForm((current) => ({
      ...current,
      launchNotifications: {
        ...current.launchNotifications,
        [key]: !current.launchNotifications[key],
      },
    }))
  }

  const toggleLanguage = (language: string) => {
    setForm((current) => ({
      ...current,
      languages: current.languages.includes(language)
        ? current.languages.filter((item) => item !== language)
        : [...current.languages, language],
    }))
    setErrors((current) => ({ ...current, languages: '' }))
  }

  const addScriptFiles = (fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList).slice(0, 10)
    const updatedFiles = [...form.scriptFiles, ...nextFiles].slice(0, 10)
    setForm((current) => ({
      ...current,
      scriptFiles: updatedFiles,
      generatedPrompt: '',
      uploadedScriptNames: [],
    }))
    setErrors((current) => ({ ...current, scriptFiles: '', generatedPrompt: '' }))
  }

  const removeScriptFile = (fileName: string, lastModified: number) => {
    setForm((current) => ({
      ...current,
      scriptFiles: current.scriptFiles.filter((file) => !(file.name === fileName && file.lastModified === lastModified)),
      generatedPrompt: '',
      uploadedScriptNames: [],
    }))
  }

  const launchReview = buildLaunchReview(form)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="relative pr-0 sm:pr-48">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-slate-900">{mode === 'create' ? 'Create New Agent' : 'Edit Agent'}</h1>
          <p className="text-slate-600">Configure the core details, personality, and channels for your AI agent.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="mt-3 h-9 gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 shadow-none hover:bg-transparent hover:text-slate-950 sm:absolute sm:right-0 sm:top-1 sm:mt-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((label, index) => (
          <div
            key={label}
            className={cn(
              'rounded-2xl border px-4 py-3 text-sm shadow-sm',
              index === step ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-500'
            )}
          >
            <div className="font-semibold">Step {index + 1}</div>
            <div>{label}</div>
          </div>
        ))}
      </div>

      <Card className="border-white/70 bg-white/95 shadow-xl">
        <CardContent className="p-8">
          {step === 0 ? (
            <div className="space-y-8">
              {/* Part 1: Prompt & Script Setup */}
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Call Flow Setup</h2>
                  <p className="mt-1 text-sm text-slate-600">Add the call-flow source, submit it to generate the structured call flow, then edit the generated output before continuing.</p>
                </div>

                <div className="space-y-2">
                  <Label>Call Flow Source</Label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPromptSourceMode('description')
                        setForm((current) => ({ ...current, generatedPrompt: '', uploadedScriptNames: [] }))
                        setErrors((current) => ({ ...current, callFlowText: '', scriptFiles: '', generatedPrompt: '' }))
                      }}
                      className={cn(
                        'rounded-2xl border p-4 text-left transition-colors',
                        promptSourceMode === 'description' ? 'border-primary bg-primary/5 shadow-sm' : 'border-slate-200 bg-white hover:border-primary/40'
                      )}
                    >
                      <div className="text-sm font-semibold text-slate-900">Write Call Flow</div>
                      <div className="mt-1 text-xs text-slate-600">Describe the conversation flow directly.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromptSourceMode('upload')
                        setForm((current) => ({ ...current, generatedPrompt: '', uploadedScriptNames: [] }))
                        setErrors((current) => ({ ...current, callFlowText: '', scriptFiles: '', generatedPrompt: '' }))
                      }}
                      className={cn(
                        'rounded-2xl border p-4 text-left transition-colors',
                        promptSourceMode === 'upload' ? 'border-primary bg-primary/5 shadow-sm' : 'border-slate-200 bg-white hover:border-primary/40'
                      )}
                    >
                      <div className="text-sm font-semibold text-slate-900">Upload Script Files</div>
                      <div className="mt-1 text-xs text-slate-600">Use existing call-flow documents to generate the prompt.</div>
                    </button>
                  </div>
                </div>

                {promptSourceMode === 'description' ? (
                  <div className="space-y-2">
                    <Label htmlFor="call-flow-description">Call Flow Description</Label>
                    <textarea
                      id="call-flow-description"
                      value={form.callFlowText}
                      onChange={(e) => {
                        setForm((current) => ({ ...current, callFlowText: e.target.value, generatedPrompt: '', uploadedScriptNames: [] }))
                        setErrors((current) => ({ ...current, callFlowText: '', generatedPrompt: '' }))
                      }}
                      rows={4}
                      placeholder="Describe the opening, qualification questions, branching rules, escalation points, and closing behavior."
                      className="flex min-h-[176px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <p className="text-xs text-slate-500">This text is used only to generate the call flow. The card description lives in General Info.</p>
                    {errors.callFlowText ? <p className="text-sm text-red-600">{errors.callFlowText}</p> : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Conversation Script Files</Label>
                    <div
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDragActive(true)
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragActive(false)
                        if (event.dataTransfer.files?.length) addScriptFiles(event.dataTransfer.files)
                      }}
                      className={cn(
                        'relative flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed p-4 text-center transition-colors',
                        dragActive ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'
                      )}
                    >
                      {generatingCallFlow ? (
                        <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center rounded-2xl z-10">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                          <p className="text-xs font-semibold text-primary">Generating call flow...</p>
                        </div>
                      ) : null}
                      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
                        <UploadCloud className="h-4 w-4" />
                      </div>
                      <div className="mt-2.5 text-sm font-medium text-slate-900">Drag &amp; drop conversation script files</div>
                      <div className="mt-1 text-xs text-slate-500">Supports up to 10 files (.txt, .json, .pdf, .docx, .xlsx, .xls)</div>
                      <label className="mt-3 inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-primary/40">
                        Choose Files
                        <input
                          type="file"
                          multiple
                          accept=".txt,.json,.pdf,.docx,.xlsx,.xls"
                          className="hidden"
                          onChange={(event) => {
                            if (event.target.files?.length) addScriptFiles(event.target.files)
                            event.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                    {form.scriptFiles.length ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {form.scriptFiles.map((file) => (
                          <span
                            key={`${file.name}-${file.lastModified}`}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                          >
                            {file.name}
                            <button
                              type="button"
                              className="text-slate-400 hover:text-slate-700"
                              onClick={() => removeScriptFile(file.name, file.lastModified)}
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {errors.scriptFiles ? <p className="text-sm text-red-600">{errors.scriptFiles}</p> : null}
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">Submit after your source is ready. The generated call flow will appear below for editing.</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {/* {import.meta.env.DEV ? (
                      <Button type="button" variant="outline" onClick={handleUseDevelopmentCallFlow} disabled={generatingCallFlow} className="shrink-0">
                        Use Dev Placeholder
                      </Button>
                    ) : null} */}
                    <Button type="button" onClick={handleGenerateCallFlow} disabled={generatingCallFlow} className="shrink-0">
                      {generatingCallFlow ? 'Generating…' : 'Submit Call Flow'}
                    </Button>
                  </div>
                </div>

                {errors.generatedPrompt ? (
                  <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Call flow could not be generated</AlertTitle>
                    <AlertDescription>
                      <p>{errors.generatedPrompt}</p>
                      <p className="mt-1 text-xs text-red-700">
                        Your input has been kept here. You can retry, paste the call flow directly, or continue once the service is available.
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {form.generatedPrompt ? (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <Label htmlFor="generated-call-flow">Generated Call Flow</Label>
                        <p className="mt-1 text-xs text-slate-500">Review and edit this JSON before moving to General Info.</p>
                      </div>
                      {form.uploadedScriptNames.length ? (
                        <p className="text-xs text-slate-500">{form.uploadedScriptNames.length} file{form.uploadedScriptNames.length === 1 ? '' : 's'} processed</p>
                      ) : null}
                    </div>
                    <textarea
                      id="generated-call-flow"
                      value={form.generatedPrompt}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, generatedPrompt: event.target.value }))
                        setErrors((current) => ({ ...current, generatedPrompt: '' }))
                      }}
                      spellCheck={false}
                      className="min-h-[320px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 font-mono text-xs leading-5 text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ) : null}
              </div>

            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">General Specifications</h2>
                <p className="mt-1 text-slate-600">Provide the agent's name, role, language, and client context details.</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="agent-name">Agent Name</Label>
                  <Input
                    id="agent-name"
                    value={form.name}
                    onChange={(e) => {
                      setForm((current) => ({ ...current, name: e.target.value }))
                      setErrors((current) => ({ ...current, name: '' }))
                    }}
                    maxLength={AGENT_NAME_MAX_LENGTH}
                    placeholder="Customer Support Agent"
                  />
                  <div className="flex justify-end text-xs text-slate-500">
                    <span>{form.name.trim().length}/{AGENT_NAME_MAX_LENGTH}</span>
                  </div>
                  {errors.name ? <p className="text-sm text-red-600">{errors.name}</p> : null}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="agent-card-description">Agent Card Description</Label>
                  <textarea
                    id="agent-card-description"
                    value={form.description}
                    onChange={(e) => {
                      setForm((current) => ({ ...current, description: e.target.value }))
                      setErrors((current) => ({ ...current, description: '' }))
                    }}
                    maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
                    rows={2}
                    placeholder="Short description shown on the AI agent card."
                    className="flex min-h-[64px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>This is the description users see on the agents list.</span>
                    <span>{form.description.trim().length}/{AGENT_DESCRIPTION_MAX_LENGTH}</span>
                  </div>
                  {errors.description ? <p className="text-sm text-red-600">{errors.description}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-use-case">Use Case</Label>
                  <select
                    id="agent-use-case"
                    value={form.useCase}
                    onChange={(e) => {
                      setForm((current) => ({ ...current, useCase: e.target.value }))
                      setErrors((current) => ({ ...current, useCase: '' }))
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select a use case</option>
                    {USE_CASES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  {errors.useCase ? <p className="text-sm text-red-600">{errors.useCase}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-client">Client</Label>
                  <select
                    id="agent-client"
                    value={form.clientId}
                    onChange={(e) => setForm((current) => ({ ...current, clientId: e.target.value }))}
                    disabled={loadingClients}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <option value="">No client scope</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>

                {!isIifl && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="agent-gender">Voice Gender</Label>
                      <select
                        id="agent-gender"
                        value={form.gender}
                        onChange={(e) => {
                          setForm((current) => ({ ...current, gender: e.target.value }))
                          setErrors((current) => ({ ...current, gender: '' }))
                        }}
                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {GENDERS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      {errors.gender ? <p className="text-sm text-red-600">{errors.gender}</p> : null}
                    </div>

                    <div className="space-y-3 md:col-span-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="agent-speech-pace">Speech Pace</Label>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                          {form.speechPace.toFixed(2).replace(/\.00$/, '.0')}x
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <input
                          id="agent-speech-pace"
                          type="range"
                          min="0.75"
                          max="1.25"
                          step="0.05"
                          value={form.speechPace}
                          onChange={(event) => {
                            setForm((current) => ({ ...current, speechPace: Number(event.target.value) }))
                          }}
                          className="h-2 w-full cursor-pointer accent-slate-950"
                        />
                        <div className="mt-2 flex items-center justify-between text-xs font-medium text-slate-500">
                          <span>Slow</span>
                          <span>Fast</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-3 md:col-span-2">
                  <div>
                    <Label>Supported Languages</Label>
                    <p className="mt-1 text-xs text-slate-600">Choose the languages this agent should support for conversations.</p>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {LANGUAGE_OPTIONS.map((language) => {
                      const selected = form.languages.includes(language)
                      return (
                        <button
                          key={language}
                          type="button"
                          onClick={() => toggleLanguage(language)}
                          className={cn(
                            'rounded-full border px-4 py-2 text-sm transition-colors',
                            selected ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-700 hover:border-primary/40'
                          )}
                        >
                          {language}
                        </button>
                      )
                    })}
                  </div>
                  {errors.languages ? <p className="text-sm text-red-600">{errors.languages}</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-slate-500" />
                <h3 className="text-lg font-semibold text-slate-900">Configuration Snapshot</h3>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Agent</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{form.name || 'Not set'}</div>
                  <p className="mt-1 text-sm text-slate-600">{form.description || 'No description provided.'}</p>
                </div>
                {!isIifl && <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Voice</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{form.gender || 'Not set'} - {form.speechPace.toFixed(2).replace(/\.00$/, '.0')}x</div>
                  <p className="mt-1 text-sm text-slate-600">{form.languages.length ? form.languages.join(', ') : 'No languages selected'}</p>
                </div>}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Calls</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{form.channels.length ? form.channels.join(', ') : 'No channels selected'}</div>
                  <p className="mt-1 text-sm text-slate-600">{form.useCase || 'No use case selected'}</p>
                </div>
              </div>
            </div>

            // <div className="space-y-4">
            //   <div>
            //     <h2 className="text-2xl font-semibold text-slate-900">Select call flow direction</h2>
            //     <p className="mt-1 text-slate-600">Choose whether this agent should answer incoming calls, place outgoing calls, or support both.</p>
            //   </div>
            //   <div className="grid gap-4 md:grid-cols-2">
            //     {CALL_MODES.map((channel) => {
            //       const selected = form.channels.includes(channel.name)
            //       return (
            //         <button
            //           key={channel.name}
            //           type="button"
            //           onClick={() => toggleChannel(channel.name)}
            //           className={cn(
            //             'rounded-2xl border p-5 text-left transition-all',
            //             selected ? 'border-primary bg-primary/5 shadow-md' : 'border-slate-200 bg-white hover:border-primary/40'
            //           )}
            //         >
            //           <div className="flex items-center gap-3">
            //             <div className={cn('inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm', channel.color)}>
            //               {channel.icon === 'inbound' ? (
            //                 <PhoneIncoming className="h-5 w-5" />
            //               ) : (
            //                 <PhoneOutgoing className="h-5 w-5" />
            //               )}
            //             </div>
            //             <div>
            //               <div className="text-lg font-semibold text-slate-900">{channel.name}</div>
            //               <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{channel.support.replace('_', ' ')}</div>
            //             </div>
            //           </div>
            //           <p className="mt-4 text-sm leading-relaxed text-slate-600">{channel.description}</p>
            //           {selected ? (
            //             <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
            //               <CheckCircle2 className="h-4 w-4" />
            //               Selected
            //             </div>
            //           ) : null}
            //         </button>
            //       )
            //     })}
            //   </div>
            //   {errors.channels ? <p className="text-sm text-red-600">{errors.channels}</p> : null}
            //   {form.channels.includes('Inbound Call') ? (
            //     <div className="space-y-5 border-t border-slate-100 pt-5">
            //       <div>
            //         <h3 className="text-lg font-semibold text-slate-900">Inbound Call Settings</h3>
            //         <p className="mt-1 text-sm text-slate-600">Configure inbound number, queue limits, fallback behavior, and follow-up options.</p>
            //       </div>

            //       <div className="grid gap-4 md:grid-cols-2">
            //         <div className="space-y-2">
            //           <Label htmlFor="inbound-did-number">Inbound DID Number</Label>
            //           <select
            //             id="inbound-did-number"
            //             value={form.inboundSettings.didNumber}
            //             onChange={(event) => updateInboundSetting('didNumber', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {INBOUND_DID_OPTIONS.map((number) => (
            //               <option key={number} value={number}>
            //                 {number}
            //               </option>
            //             ))}
            //           </select>
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="max-concurrent-inbound">Max Concurrent Inbound Calls</Label>
            //           <Input
            //             id="max-concurrent-inbound"
            //             type="number"
            //             min={1}
            //             value={form.inboundSettings.maxConcurrentCalls}
            //             onChange={(event) => updateInboundSetting('maxConcurrentCalls', Number(event.target.value))}
            //           />
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="queue-wait-limit">Queue Wait Limit (sec)</Label>
            //           <Input
            //             id="queue-wait-limit"
            //             type="number"
            //             min={0}
            //             value={form.inboundSettings.queueWaitLimitSec}
            //             onChange={(event) => updateInboundSetting('queueWaitLimitSec', Number(event.target.value))}
            //           />
            //           <p className="text-xs text-slate-500">Caller hears hold music up to this limit.</p>
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="max-call-duration">Max Call Duration</Label>
            //           <select
            //             id="max-call-duration"
            //             value={form.inboundSettings.maxCallDuration}
            //             onChange={(event) => updateInboundSetting('maxCallDuration', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {MAX_CALL_DURATION_OPTIONS.map((duration) => (
            //               <option key={duration} value={duration}>
            //                 {duration}
            //               </option>
            //             ))}
            //           </select>
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="off-hours-behavior">Off-Hours Behavior</Label>
            //           <select
            //             id="off-hours-behavior"
            //             value={form.inboundSettings.offHoursBehavior}
            //             onChange={(event) => updateInboundSetting('offHoursBehavior', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {OFF_HOURS_OPTIONS.map((option) => (
            //               <option key={option} value={option}>
            //                 {option}
            //               </option>
            //             ))}
            //           </select>
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="ivr-fallback">IVR Fallback</Label>
            //           <select
            //             id="ivr-fallback"
            //             value={form.inboundSettings.ivrFallback}
            //             onChange={(event) => updateInboundSetting('ivrFallback', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {IVR_FALLBACK_OPTIONS.map((option) => (
            //               <option key={option} value={option}>
            //                 {option}
            //               </option>
            //             ))}
            //           </select>
            //         </div>
            //       </div>

            //       <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            //         <div className="flex items-center justify-between gap-4 px-4 py-4">
            //           <div>
            //             <div className="text-sm font-semibold text-slate-900">Post-call SMS Follow-up</div>
            //             <p className="mt-1 text-xs text-slate-500">Send an SMS summary after each call.</p>
            //           </div>
            //           <button
            //             type="button"
            //             role="switch"
            //             aria-checked={form.inboundSettings.postCallSmsFollowUp}
            //             onClick={() => updateInboundSetting('postCallSmsFollowUp', !form.inboundSettings.postCallSmsFollowUp)}
            //             className={cn(
            //               'relative h-7 w-12 shrink-0 rounded-full transition-colors',
            //               form.inboundSettings.postCallSmsFollowUp ? 'bg-primary' : 'bg-slate-300'
            //             )}
            //           >
            //             <span
            //               className={cn(
            //                 'absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            //                 form.inboundSettings.postCallSmsFollowUp ? 'translate-x-6' : 'translate-x-1'
            //               )}
            //             />
            //           </button>
            //         </div>

            //         <div className="flex items-center justify-between gap-4 px-4 py-4">
            //           <div>
            //             <div className="text-sm font-semibold text-slate-900">Callback Scheduling</div>
            //             <p className="mt-1 text-xs text-slate-500">Allow callers to book a callback slot instead of waiting in queue.</p>
            //           </div>
            //           <button
            //             type="button"
            //             role="switch"
            //             aria-checked={form.inboundSettings.callbackScheduling}
            //             onClick={() => updateInboundSetting('callbackScheduling', !form.inboundSettings.callbackScheduling)}
            //             className={cn(
            //               'relative h-7 w-12 shrink-0 rounded-full transition-colors',
            //               form.inboundSettings.callbackScheduling ? 'bg-primary' : 'bg-slate-300'
            //             )}
            //           >
            //             <span
            //               className={cn(
            //                 'absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            //                 form.inboundSettings.callbackScheduling ? 'translate-x-6' : 'translate-x-1'
            //               )}
            //             />
            //           </button>
            //         </div>
            //       </div>
            //     </div>
            //   ) : null}
            //   {form.channels.includes('Outbound Call') ? (
            //     <div className="space-y-5 border-t border-slate-100 pt-5">
            //       <div>
            //         <h3 className="text-lg font-semibold text-slate-900">Outbound Call Settings</h3>
            //         <p className="mt-1 text-sm text-slate-600">Configure rotation, dialing pace, campaign windows, and outbound compliance behavior.</p>
            //       </div>

            //       <div className="grid gap-4 md:grid-cols-2">
            //         <div className="space-y-2">
            //           <Label htmlFor="rotation-strategy">Rotation Strategy</Label>
            //           <select
            //             id="rotation-strategy"
            //             value={form.outboundSettings.rotationStrategy}
            //             onChange={(event) => updateOutboundSetting('rotationStrategy', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {ROTATION_STRATEGY_OPTIONS.map((option) => (
            //               <option key={option} value={option}>
            //                 {option}
            //               </option>
            //             ))}
            //           </select>
            //         </div>

            //         <div className="space-y-2">
            //           <Label htmlFor="rotate-after-every">Rotate After Every</Label>
            //           <select
            //             id="rotate-after-every"
            //             value={form.outboundSettings.rotateAfterEvery}
            //             onChange={(event) => updateOutboundSetting('rotateAfterEvery', event.target.value)}
            //             className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //           >
            //             {ROTATE_AFTER_OPTIONS.map((option) => (
            //               <option key={option} value={option}>
            //                 {option}
            //               </option>
            //             ))}
            //           </select>
            //         </div>
            //       </div>

            //       <div className="space-y-4 border-t border-slate-100 pt-5">
            //         <h4 className="text-sm font-semibold text-slate-900">Dialing & Pacing</h4>
            //         <div className="grid gap-4 md:grid-cols-2">
            //           <div className="space-y-2">
            //             <Label htmlFor="dialing-mode">Dialing Mode</Label>
            //             <select
            //               id="dialing-mode"
            //               value={form.outboundSettings.dialingMode}
            //               onChange={(event) => updateOutboundSetting('dialingMode', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {DIALING_MODE_OPTIONS.map((option) => (
            //                 <option key={option} value={option}>
            //                   {option}
            //                 </option>
            //               ))}
            //             </select>
            //             <p className="text-xs text-slate-500">Predictive dials ahead of agent availability.</p>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="calls-per-minute">Calls Per Minute (CPM)</Label>
            //             <Input
            //               id="calls-per-minute"
            //               type="number"
            //               min={1}
            //               value={form.outboundSettings.callsPerMinute}
            //               onChange={(event) => updateOutboundSetting('callsPerMinute', Number(event.target.value))}
            //             />
            //             <p className="text-xs text-slate-500">Max simultaneous call attempts.</p>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="outbound-max-call-duration">Max Call Duration</Label>
            //             <select
            //               id="outbound-max-call-duration"
            //               value={form.outboundSettings.maxCallDuration}
            //               onChange={(event) => updateOutboundSetting('maxCallDuration', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {MAX_CALL_DURATION_OPTIONS.map((duration) => (
            //                 <option key={duration} value={duration}>
            //                   {duration}
            //                 </option>
            //               ))}
            //             </select>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="ring-timeout">Ring Timeout (sec)</Label>
            //             <Input
            //               id="ring-timeout"
            //               type="number"
            //               min={5}
            //               value={form.outboundSettings.ringTimeoutSec}
            //               onChange={(event) => updateOutboundSetting('ringTimeoutSec', Number(event.target.value))}
            //             />
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="max-retries">Max Retries Per Contact</Label>
            //             <Input
            //               id="max-retries"
            //               type="number"
            //               min={0}
            //               value={form.outboundSettings.maxRetriesPerContact}
            //               onChange={(event) => updateOutboundSetting('maxRetriesPerContact', Number(event.target.value))}
            //             />
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="retry-interval">Retry Interval</Label>
            //             <select
            //               id="retry-interval"
            //               value={form.outboundSettings.retryInterval}
            //               onChange={(event) => updateOutboundSetting('retryInterval', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {RETRY_INTERVAL_OPTIONS.map((option) => (
            //                 <option key={option} value={option}>
            //                   {option}
            //                 </option>
            //               ))}
            //             </select>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="daily-call-limit">Daily Call Limit Per Contact</Label>
            //             <Input
            //               id="daily-call-limit"
            //               type="number"
            //               min={1}
            //               value={form.outboundSettings.dailyCallLimitPerContact}
            //               onChange={(event) => updateOutboundSetting('dailyCallLimitPerContact', Number(event.target.value))}
            //             />
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="campaign-call-cap">Total Campaign Call Cap</Label>
            //             <Input
            //               id="campaign-call-cap"
            //               type="number"
            //               min={1}
            //               value={form.outboundSettings.totalCampaignCallCap}
            //               onChange={(event) => updateOutboundSetting('totalCampaignCallCap', Number(event.target.value))}
            //             />
            //             <p className="text-xs text-slate-500">Hard cap across all contacts.</p>
            //           </div>
            //         </div>
            //       </div>

            //       <div className="space-y-4 border-t border-slate-100 pt-5">
            //         <h4 className="text-sm font-semibold text-slate-900">Campaign Time Limits</h4>
            //         <div className="grid gap-4 md:grid-cols-2">
            //           <div className="space-y-2">
            //             <Label>Calling Window</Label>
            //             <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            //               <Input
            //                 type="time"
            //                 value={form.outboundSettings.callingWindowStart}
            //                 onChange={(event) => updateOutboundSetting('callingWindowStart', event.target.value)}
            //               />
            //               <span className="text-sm text-slate-500">to</span>
            //               <Input
            //                 type="time"
            //                 value={form.outboundSettings.callingWindowEnd}
            //                 onChange={(event) => updateOutboundSetting('callingWindowEnd', event.target.value)}
            //               />
            //             </div>
            //             <p className="text-xs text-slate-500">Local customer timezone applied.</p>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="outbound-timezone">Timezone</Label>
            //             <select
            //               id="outbound-timezone"
            //               value={form.outboundSettings.timezone}
            //               onChange={(event) => updateOutboundSetting('timezone', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {TIMEZONE_OPTIONS.map((option) => (
            //                 <option key={option} value={option}>
            //                   {option}
            //                 </option>
            //               ))}
            //             </select>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="campaign-start-date">Campaign Start Date</Label>
            //             <Input
            //               id="campaign-start-date"
            //               type="date"
            //               value={form.outboundSettings.campaignStartDate}
            //               onChange={(event) => updateOutboundSetting('campaignStartDate', event.target.value)}
            //             />
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="campaign-end-date">Campaign End Date</Label>
            //             <Input
            //               id="campaign-end-date"
            //               type="date"
            //               value={form.outboundSettings.campaignEndDate}
            //               onChange={(event) => updateOutboundSetting('campaignEndDate', event.target.value)}
            //             />
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="active-days">Active Days</Label>
            //             <select
            //               id="active-days"
            //               value={form.outboundSettings.activeDays}
            //               onChange={(event) => updateOutboundSetting('activeDays', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {ACTIVE_DAYS_OPTIONS.map((option) => (
            //                 <option key={option} value={option}>
            //                   {option}
            //                 </option>
            //               ))}
            //             </select>
            //           </div>

            //           <div className="space-y-2">
            //             <Label htmlFor="pause-campaign-on">Pause Campaign On</Label>
            //             <select
            //               id="pause-campaign-on"
            //               value={form.outboundSettings.pauseCampaignOn}
            //               onChange={(event) => updateOutboundSetting('pauseCampaignOn', event.target.value)}
            //               className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            //             >
            //               {PAUSE_CAMPAIGN_OPTIONS.map((option) => (
            //                 <option key={option} value={option}>
            //                   {option}
            //                 </option>
            //               ))}
            //             </select>
            //           </div>
            //         </div>
            //       </div>

            //       <div className="space-y-3 border-t border-slate-100 pt-5">
            //         <h4 className="text-sm font-semibold text-slate-900">Compliance & Behavior</h4>
            //         <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            //           {OUTBOUND_COMPLIANCE_OPTIONS.map((option) => (
            //             <div key={option.key} className="flex items-center justify-between gap-4 px-4 py-4">
            //               <div>
            //                 <div className="text-sm font-semibold text-slate-900">{option.title}</div>
            //                 <p className="mt-1 text-xs text-slate-500">{option.description}</p>
            //               </div>
            //               <button
            //                 type="button"
            //                 role="switch"
            //                 aria-checked={form.outboundSettings[option.key]}
            //                 onClick={() => updateOutboundSetting(option.key, !form.outboundSettings[option.key])}
            //                 className={cn(
            //                   'relative h-7 w-12 shrink-0 rounded-full transition-colors',
            //                   form.outboundSettings[option.key] ? 'bg-primary' : 'bg-slate-300'
            //                 )}
            //               >
            //                 <span
            //                   className={cn(
            //                     'absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            //                     form.outboundSettings[option.key] ? 'translate-x-6' : 'translate-x-1'
            //                   )}
            //                 />
            //               </button>
            //             </div>
            //           ))}
            //         </div>
            //       </div>
            //     </div>
            //   ) : null}
            // </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Call Review</h2>
                <p className="mt-1 text-slate-600">Review readiness, launch risks, estimated load, and alert preferences before saving.</p>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold text-slate-900">Pre-launch Checklist</h3>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      {launchReview.passed} / {launchReview.checklist.length} passed
                    </span>
                  </div>

                  <div className="mt-4 divide-y divide-slate-100">
                    {launchReview.checklist.map((item) => (
                      <div key={item.title} className="flex gap-3 py-4">
                        <div
                          className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                            item.passed ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                          )}
                        >
                          {item.passed ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                          <p className="mt-1 text-sm leading-5 text-slate-600">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Gauge className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold text-slate-900">Readiness Score</h3>
                    </div>
                    <div className="mt-5 flex justify-center">
                      <div
                        className="flex h-28 w-28 items-center justify-center rounded-full"
                        style={{ background: `conic-gradient(#0f766e ${launchReview.readinessScore * 3.6}deg, #e2e8f0 0deg)` }}
                      >
                        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white shadow-inner">
                          <span className="text-2xl font-bold text-emerald-700">{launchReview.readinessScore}</span>
                          <span className="text-xs font-semibold text-slate-500">/ 100</span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-4 text-center text-sm font-medium text-slate-700">
                      {launchReview.warnings ? `${launchReview.warnings} warning${launchReview.warnings === 1 ? '' : 's'} to review before launch.` : 'Agent is ready to go live.'}
                    </p>
                    <div className="mt-5 space-y-3">
                      {launchReview.scoreSections.map((section) => (
                        <div key={section.label}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-600">{section.label}</span>
                            <span className="font-semibold text-slate-900">{section.value}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn('h-full rounded-full', section.value >= 90 ? 'bg-emerald-500' : section.value >= 70 ? 'bg-amber-500' : 'bg-red-500')}
                              style={{ width: `${section.value}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold text-slate-900">Estimated Load</h3>
                    </div>
                    <div className="mt-4 space-y-3 text-sm">
                      {[
                        ['Contacts in list', launchReview.estimatedLoad.contacts],
                        ['Est. calls / day', launchReview.estimatedLoad.callsPerDay],
                        ['Est. duration / day', launchReview.estimatedLoad.durationPerDay],
                        ['Campaign end', launchReview.estimatedLoad.campaignEnd],
                        ['Call cap remaining', launchReview.estimatedLoad.capRemaining],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-4">
                          <span className="font-medium text-slate-600">{label}</span>
                          <span className="text-right font-semibold text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold text-slate-900">Alert & Notification</h3>
                    </div>
                    <div className="mt-4 space-y-4">
                      {[
                        ['lowConnectRateAlert', 'Low connect rate alert', 'Notify if below 40%'],
                        ['highEscalationAlert', 'High escalation alert', 'Notify if above 15%'],
                        ['campaignCompletion', 'Campaign completion', 'Notify on 100% dial'],
                        ['dailySummaryEmail', 'Daily summary email', 'End-of-day report'],
                      ].map(([key, title, detail]) => {
                        const notificationKey = key as keyof LaunchNotificationSettings
                        return (
                          <div key={key} className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{title}</div>
                              <p className="text-xs text-slate-500">{detail}</p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={form.launchNotifications[notificationKey]}
                              onClick={() => toggleLaunchNotification(notificationKey)}
                              className={cn(
                                'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                                form.launchNotifications[notificationKey] ? 'bg-primary' : 'bg-slate-300'
                              )}
                            >
                              <span
                                className={cn(
                                  'absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
                                  form.launchNotifications[notificationKey] ? 'translate-x-6' : 'translate-x-1'
                                )}
                              />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-slate-500" />
                  <h3 className="text-lg font-semibold text-slate-900">Configuration Snapshot</h3>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Agent</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{form.name || 'Not set'}</div>
                    <p className="mt-1 text-sm text-slate-600">{form.description || 'No description provided.'}</p>
                  </div>
                  {!isIifl && <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Voice</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{form.gender || 'Not set'} - {form.speechPace.toFixed(2).replace(/\.00$/, '.0')}x</div>
                    <p className="mt-1 text-sm text-slate-600">{form.languages.length ? form.languages.join(', ') : 'No languages selected'}</p>
                  </div>}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Calls</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{form.channels.length ? form.channels.join(', ') : 'No channels selected'}</div>
                    <p className="mt-1 text-sm text-slate-600">{form.useCase || 'No use case selected'}</p>
                  </div>
                </div>
              </div> */}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3 border-t border-slate-100 px-8 py-6">
          <Button type="button" variant="ghost" onClick={step === 0 ? onCancel : () => setStep((current) => Math.max(current - 1, 0))}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={handleNext} disabled={generatingCallFlow}>
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create Agent' : 'Save Changes'}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default function AIAgents() {
  const { user } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingClients, setLoadingClients] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [cloneTarget, setCloneTarget] = useState<Agent | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloning, setCloning] = useState(false)
  const navigate = useNavigate()
  const { agentId, adminSlug } = useParams()
  const base = `/${adminSlug}/ai-agents`
  const role = user?.role ?? 'client'
  const hasAgentsAccess = !!user && canViewAgents(role)
  const showInsights = hasAgentsAccess && canViewAgentInsights(role)
  const showPlayground = hasAgentsAccess && canUseAgentPlayground(role)
  const canEditAgents = !!user && canManageAgents(role)

  const visibleAgents = useMemo(() => {
    const q = searchTerm.trim()
    if (!q) return agents
    return agents.filter((agent) => matchesAgentSearch(agent, q))
  }, [agents, searchTerm])

  const refreshAgents = async () => {
    const rows = await readAgents()
    setAgents(rows)
    return rows
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await readAgents()
        if (!cancelled) setAgents(rows)
      } catch (error) {
        console.error('Failed to load agents', error)
        if (!cancelled) toast.error('Unable to load agents. Please refresh and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!canEditAgents) return
    let cancelled = false
    setLoadingClients(true)
    void (async () => {
      try {
        const rows = await readClients()
        if (!cancelled) setClients(rows)
      } catch (error) {
        console.error('Failed to load clients', error)
      } finally {
        if (!cancelled) setLoadingClients(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canEditAgents])

  useEffect(() => {
    if (!agentId || agents.length === 0) return
    const current = agents.find((item) => item.agent_id === agentId)
    if (current) setSelectedAgent(current)
  }, [agentId, agents])

  const editInitialValue = useMemo(() => defaultAgentForm(selectedAgent ?? agents.find((item) => item.agent_id === agentId)), [agentId, agents, selectedAgent])

  const handlePlayground = (id: string) => {
    setSelectedAgent(agents.find((item) => item.agent_id === id) ?? null)
    navigate(`${base}/${id}/playground`)
  }

  const handleEdit = (id: string) => {
    setSelectedAgent(agents.find((item) => item.agent_id === id) ?? null)
    navigate(`${base}/${id}/edit`)
  }

  const handleCloneRequest = (agent: Agent) => {
    setCloneTarget(agent)
    setCloneName(`${agent.name} Copy`)
  }

  const handleCloneConfirm = async () => {
    if (!cloneTarget) return
    const nextName = cloneName.trim()
    if (!nextName) {
      toast.error('Enter a name for the cloned agent')
      return
    }
    if (nextName.toLowerCase() === cloneTarget.name.trim().toLowerCase()) {
      toast.error('Use a different name for the cloned agent')
      return
    }

    setCloning(true)
    try {
      const cloned = await saveAgent({ ...defaultAgentForm(cloneTarget), name: nextName })
      await refreshAgents()
      toast.success(`Cloned ${cloneTarget.name} as ${cloned.name}`)
      setCloneTarget(null)
      setCloneName('')
    } catch (error) {
      console.error('Failed to clone agent', error)
      toast.error(getUserErrorMessage(error, 'Unable to clone the agent. Please try again.'))
    } finally {
      setCloning(false)
    }
  }

  const handleBackToAgents = () => {
    navigate(base)
    setSelectedAgent(null)
  }

  const handleCreate = async (value: AgentFormValue) => {
    const created = await saveAgent(value)
    await refreshAgents()
    toast.success(`Created ${created.name}`)
    navigate(base)
  }

  const handleUpdate = async (value: AgentFormValue) => {
    if (!agentId) return
    const updated = await saveAgent(value, agentId)
    await refreshAgents()
    toast.success(`Updated ${updated.name}`)
    navigate(base)
  }

  const handleDelete = async (id: string) => {
    const target = agents.find((item) => item.agent_id === id)
    if (!target) return
    const confirmed = window.confirm(`Delete "${target.name}"? This cannot be undone.`)
    if (!confirmed) return

    try {
      await deleteAgent(id)
      await refreshAgents()
      if (agentId === id) {
        navigate(base)
        setSelectedAgent(null)
      }
      toast.success(`Deleted ${target.name}`)
    } catch (error) {
      console.error('Failed to delete agent', error)
      toast.error(getUserErrorMessage(error, 'Unable to delete the agent. Please try again.'))
    }
  }

  if (!hasAgentsAccess) {
    return <Navigate to={user ? getDefaultAuthorizedPath(user) : '/signin'} replace />
  }

  const agentsIndex = (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">My Agents</h1>
        <label className="relative block min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search agents..."
            className={cn('h-10 bg-white pl-9', brandSearchInputClass)}
          />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading agents…</p>
          </div>
        </div>
      ) : visibleAgents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-900">No agents match &ldquo;{searchTerm.trim()}&rdquo;</p>
          <p className="mt-1 text-sm text-slate-500">Try name, type, or agent id.</p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {canEditAgents && !searchTerm.trim() ? <CreateAgentCard onCreate={() => navigate(`${base}/create`)} /> : null}
          {visibleAgents.map((agent) => (
            <AgentCard
              key={agent.agent_id}
              agent={agent}
              showPlayground={showPlayground}
              canEdit={canEditAgents}
              onPlayground={handlePlayground}
              onEdit={handleEdit}
              onClone={handleCloneRequest}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="w-full px-3 py-4">
      <Routes>
        <Route index element={agentsIndex} />
        <Route
          path="create"
          element={
            canEditAgents ? (
              <AgentWizard
                mode="create"
                initialValue={defaultAgentForm()}
                clients={clients}
                loadingClients={loadingClients}
                onSubmit={handleCreate}
                onCancel={handleBackToAgents}
              />
            ) : (
              <Navigate to={base} replace />
            )
          }
        />
        <Route
          path=":agentId/edit"
          element={
            canEditAgents ? (
              <AgentWizard
                mode="edit"
                initialValue={editInitialValue}
                clients={clients}
                loadingClients={loadingClients}
                onSubmit={handleUpdate}
                onCancel={handleBackToAgents}
              />
            ) : (
              <Navigate to={base} replace />
            )
          }
        />
        <Route
          path=":agentId/logs"
          element={showInsights ? <CallLogs agent={selectedAgent} onBack={handleBackToAgents} /> : <Navigate to={base} replace />}
        />
        <Route
          path=":agentId/analytics"
          element={showInsights ? <CallAnalytics agent={selectedAgent} onBack={handleBackToAgents} /> : <Navigate to={base} replace />}
        />
        <Route
          path=":agentId/playground"
          element={
            showPlayground ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">Playground</h2>
                    <p className="text-slate-600">Test {selectedAgent?.name ?? 'agent'}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleBackToAgents} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Agents
                  </Button>
                </div>
                <AgentPlayground agentId={selectedAgent?.agent_id ?? agentId ?? undefined} />
              </div>
            ) : (
              <Navigate to={base} replace />
            )
          }
        />
      </Routes>
      {cloneTarget ? (
        <CloneAgentModal
          agent={cloneTarget}
          name={cloneName}
          saving={cloning}
          onNameChange={setCloneName}
          onClose={() => {
            if (cloning) return
            setCloneTarget(null)
            setCloneName('')
          }}
          onConfirm={handleCloneConfirm}
        />
      ) : null}
    </div>
  )
}
