import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, count, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { agentActivityLogs, bots, campaigns, clients } from '../db/schema'
import { canManageAgents, canViewAgents } from '../lib/roles'
import { extractTextFromPromptFile, generateAgentPrompt, generatePromptFromText } from '../services/promptGenerator'
import type { AppEnv } from '../types'
import { authMiddleware } from '../middleware/auth'

const CHANNEL_SUPPORT_DEFAULTS = {
  Phone: 'supported',
  WhatsApp: 'planned',
  Email: 'planned',
  'Web Calls': 'planned',
  'App Calls': 'planned',
  'Web Chat': 'coming_soon',
  'App Chat': 'coming_soon',
} as const

const DEFAULT_INBOUND_SETTINGS = {
  didNumber: '+91 80 4567 8900',
  maxConcurrentCalls: 50,
  queueWaitLimitSec: 60,
  maxCallDuration: '10 min',
  offHoursBehavior: 'Play voicemail message',
  ivrFallback: 'Enabled - 3 options',
  postCallSmsFollowUp: true,
  callbackScheduling: false,
}

const inboundSettingsSchema = z.object({
  didNumber: z.string().trim().min(1).max(40).default(DEFAULT_INBOUND_SETTINGS.didNumber),
  maxConcurrentCalls: z.coerce.number().int().min(1).max(500).default(DEFAULT_INBOUND_SETTINGS.maxConcurrentCalls),
  queueWaitLimitSec: z.coerce.number().int().min(0).max(3600).default(DEFAULT_INBOUND_SETTINGS.queueWaitLimitSec),
  maxCallDuration: z.string().trim().min(1).max(20).default(DEFAULT_INBOUND_SETTINGS.maxCallDuration),
  offHoursBehavior: z.string().trim().min(1).max(80).default(DEFAULT_INBOUND_SETTINGS.offHoursBehavior),
  ivrFallback: z.string().trim().min(1).max(80).default(DEFAULT_INBOUND_SETTINGS.ivrFallback),
  postCallSmsFollowUp: z.coerce.boolean().default(DEFAULT_INBOUND_SETTINGS.postCallSmsFollowUp),
  callbackScheduling: z.coerce.boolean().default(DEFAULT_INBOUND_SETTINGS.callbackScheduling),
})

const DEFAULT_OUTBOUND_SETTINGS = {
  rotationStrategy: 'Round robin',
  rotateAfterEvery: '1 call',
  dialingMode: 'Predictive',
  callsPerMinute: 30,
  maxCallDuration: '5 min',
  ringTimeoutSec: 30,
  maxRetriesPerContact: 3,
  retryInterval: '2 hours',
  dailyCallLimitPerContact: 2,
  totalCampaignCallCap: 5000,
  callingWindowStart: '09:00',
  callingWindowEnd: '20:00',
  timezone: 'Auto-detect (customer)',
  campaignStartDate: '',
  campaignEndDate: '',
  activeDays: 'Mon-Sat',
  pauseCampaignOn: 'Public holidays',
  dncScrubbing: true,
  voicemailDetectionDrop: true,
  callRecording: true,
  realtimeSentimentMonitoring: false,
  humanHandoffTrigger: true,
}

const outboundSettingsSchema = z.object({
  rotationStrategy: z.string().trim().min(1).max(80).default(DEFAULT_OUTBOUND_SETTINGS.rotationStrategy),
  rotateAfterEvery: z.string().trim().min(1).max(40).default(DEFAULT_OUTBOUND_SETTINGS.rotateAfterEvery),
  dialingMode: z.string().trim().min(1).max(80).default(DEFAULT_OUTBOUND_SETTINGS.dialingMode),
  callsPerMinute: z.coerce.number().int().min(1).max(1000).default(DEFAULT_OUTBOUND_SETTINGS.callsPerMinute),
  maxCallDuration: z.string().trim().min(1).max(20).default(DEFAULT_OUTBOUND_SETTINGS.maxCallDuration),
  ringTimeoutSec: z.coerce.number().int().min(5).max(300).default(DEFAULT_OUTBOUND_SETTINGS.ringTimeoutSec),
  maxRetriesPerContact: z.coerce.number().int().min(0).max(20).default(DEFAULT_OUTBOUND_SETTINGS.maxRetriesPerContact),
  retryInterval: z.string().trim().min(1).max(40).default(DEFAULT_OUTBOUND_SETTINGS.retryInterval),
  dailyCallLimitPerContact: z.coerce.number().int().min(1).max(50).default(DEFAULT_OUTBOUND_SETTINGS.dailyCallLimitPerContact),
  totalCampaignCallCap: z.coerce.number().int().min(1).max(10000000).default(DEFAULT_OUTBOUND_SETTINGS.totalCampaignCallCap),
  callingWindowStart: z.string().trim().min(1).max(10).default(DEFAULT_OUTBOUND_SETTINGS.callingWindowStart),
  callingWindowEnd: z.string().trim().min(1).max(10).default(DEFAULT_OUTBOUND_SETTINGS.callingWindowEnd),
  timezone: z.string().trim().min(1).max(80).default(DEFAULT_OUTBOUND_SETTINGS.timezone),
  campaignStartDate: z.string().trim().max(20).default(DEFAULT_OUTBOUND_SETTINGS.campaignStartDate),
  campaignEndDate: z.string().trim().max(20).default(DEFAULT_OUTBOUND_SETTINGS.campaignEndDate),
  activeDays: z.string().trim().min(1).max(40).default(DEFAULT_OUTBOUND_SETTINGS.activeDays),
  pauseCampaignOn: z.string().trim().min(1).max(80).default(DEFAULT_OUTBOUND_SETTINGS.pauseCampaignOn),
  dncScrubbing: z.coerce.boolean().default(DEFAULT_OUTBOUND_SETTINGS.dncScrubbing),
  voicemailDetectionDrop: z.coerce.boolean().default(DEFAULT_OUTBOUND_SETTINGS.voicemailDetectionDrop),
  callRecording: z.coerce.boolean().default(DEFAULT_OUTBOUND_SETTINGS.callRecording),
  realtimeSentimentMonitoring: z.coerce.boolean().default(DEFAULT_OUTBOUND_SETTINGS.realtimeSentimentMonitoring),
  humanHandoffTrigger: z.coerce.boolean().default(DEFAULT_OUTBOUND_SETTINGS.humanHandoffTrigger),
})

const DEFAULT_LAUNCH_NOTIFICATIONS = {
  lowConnectRateAlert: true,
  highEscalationAlert: true,
  campaignCompletion: true,
  dailySummaryEmail: true,
}

const launchNotificationsSchema = z.object({
  lowConnectRateAlert: z.coerce.boolean().default(DEFAULT_LAUNCH_NOTIFICATIONS.lowConnectRateAlert),
  highEscalationAlert: z.coerce.boolean().default(DEFAULT_LAUNCH_NOTIFICATIONS.highEscalationAlert),
  campaignCompletion: z.coerce.boolean().default(DEFAULT_LAUNCH_NOTIFICATIONS.campaignCompletion),
  dailySummaryEmail: z.coerce.boolean().default(DEFAULT_LAUNCH_NOTIFICATIONS.dailySummaryEmail),
})

const agentPayloadSchema = z.object({
  name: z.string().trim().min(1).max(25),
  description: z.string().trim().max(50).optional().default(''),
  callFlowText: z.string().trim().max(50000).optional().default(''),
  generatedPrompt: z.unknown().optional(),
  uploadedScriptNames: z.array(z.string().trim().min(1).max(240)).max(10).optional().default([]),
  useCase: z.string().trim().min(1).max(80),
  gender: z.enum(['Male', 'Female', 'Neutral']),
  speechPace: z.coerce.number().min(0.75).max(1.25).optional().default(1),
  personality: z.string().trim().min(1).max(80),
  languages: z.array(z.string().trim().min(1).max(40)).min(1).max(16),
  channels: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  inboundSettings: inboundSettingsSchema.optional().default(DEFAULT_INBOUND_SETTINGS),
  outboundSettings: outboundSettingsSchema.optional().default(DEFAULT_OUTBOUND_SETTINGS),
  launchNotifications: launchNotificationsSchema.optional().default(DEFAULT_LAUNCH_NOTIFICATIONS),
  clientId: z.string().trim().min(1).optional().nullable(),
})

type AgentMeta = {
  type?: string
  description?: string
  status?: string
  useCase?: string
  gender?: string
  speechPace?: number
  personality?: string
  languages?: string[]
  channels?: string[]
  inboundSettings?: z.infer<typeof inboundSettingsSchema>
  outboundSettings?: z.infer<typeof outboundSettingsSchema>
  launchNotifications?: z.infer<typeof launchNotificationsSchema>
  channelSupport?: Record<string, string>
  callFlowText?: string
  generatedPrompt?: Record<string, unknown>
  uploadedScriptNames?: string[]
}

function promptServiceFailure(
  c: Context<AppEnv>,
  message: string,
  error: unknown,
  code: 'PROMPT_EXTRACTION_FAILED' | 'PROMPT_GENERATION_FAILED',
) {
  console.error(`[agents] ${code}:`, error)
  return c.json(
    {
      success: false,
      error: message,
      code,
    },
    502,
  )
}

function injectLanguagesIntoPrompt(promptObj: any, languages: string[]) {
  if (!promptObj || typeof promptObj !== 'object' || Array.isArray(promptObj)) return promptObj

  const selectedLanguages = languages && languages.length > 0 ? languages : ['English']
  const updated = { ...promptObj }

  // 1. Set at root level
  updated.language_settings = {
    supported: selectedLanguages
  }

  // 2. Set inside system_prompt
  if (updated.system_prompt && typeof updated.system_prompt === 'object' && !Array.isArray(updated.system_prompt)) {
    updated.system_prompt = {
      ...updated.system_prompt,
      language_settings: {
        supported: selectedLanguages
      }
    }
  }

  // 3. Set inside data and data.system_prompt
  if (updated.data && typeof updated.data === 'object' && !Array.isArray(updated.data)) {
    updated.data = { ...updated.data }
    updated.data.language_settings = {
      supported: selectedLanguages
    }
    if (updated.data.system_prompt && typeof updated.data.system_prompt === 'object' && !Array.isArray(updated.data.system_prompt)) {
      updated.data.system_prompt = {
        ...updated.data.system_prompt,
        language_settings: {
          supported: selectedLanguages
        }
      }
    }
  }

  return updated
}

function parseAgentMeta(value: string | null): AgentMeta {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as AgentMeta
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function deriveLegacyUseCase(type?: string) {
  if (!type) return 'AI Agent'
  if (type === 'Customer Support Agent') return 'Customer Support'
  if (type === 'Financial Service Agent') return 'Collections'
  if (type === 'Employee Feedback Agent') return 'Survey'
  if (type === 'Customer Feedback Agent') return 'Survey'
  return type
}

function normalizeAgentMeta(meta: AgentMeta, fallbackDescription = '') {
  const type = typeof meta.type === 'string' && meta.type.trim() ? meta.type.trim() : 'AI Agent'
  const description =
    typeof meta.description === 'string' && meta.description.trim() ? meta.description.trim() : fallbackDescription
  const status = typeof meta.status === 'string' && meta.status.trim() ? meta.status.trim() : 'active'
  const useCase = typeof meta.useCase === 'string' && meta.useCase.trim() ? meta.useCase.trim() : deriveLegacyUseCase(type)
  const gender = typeof meta.gender === 'string' && meta.gender.trim() ? meta.gender.trim() : 'Neutral'
  const speechPace = typeof meta.speechPace === 'number' && Number.isFinite(meta.speechPace) ? meta.speechPace : 1
  const personality = typeof meta.personality === 'string' && meta.personality.trim() ? meta.personality.trim() : undefined
  const languages = Array.isArray(meta.languages)
    ? meta.languages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const channels = Array.isArray(meta.channels) ? meta.channels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const inboundSettings = inboundSettingsSchema.safeParse(meta.inboundSettings).success
    ? inboundSettingsSchema.parse(meta.inboundSettings)
    : DEFAULT_INBOUND_SETTINGS
  const outboundSettings = outboundSettingsSchema.safeParse(meta.outboundSettings).success
    ? outboundSettingsSchema.parse(meta.outboundSettings)
    : DEFAULT_OUTBOUND_SETTINGS
  const launchNotifications = launchNotificationsSchema.safeParse(meta.launchNotifications).success
    ? launchNotificationsSchema.parse(meta.launchNotifications)
    : DEFAULT_LAUNCH_NOTIFICATIONS
  const channelSupport =
    meta.channelSupport && typeof meta.channelSupport === 'object'
      ? Object.fromEntries(Object.entries(meta.channelSupport).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : undefined
  const callFlowText = typeof meta.callFlowText === 'string' ? meta.callFlowText : ''
  const generatedPrompt =
    meta.generatedPrompt && typeof meta.generatedPrompt === 'object' && !Array.isArray(meta.generatedPrompt) ? meta.generatedPrompt : undefined
  const uploadedScriptNames = Array.isArray(meta.uploadedScriptNames)
    ? meta.uploadedScriptNames.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  return {
    type,
    description,
    status,
    useCase,
    gender,
    speechPace,
    personality,
    languages,
    channels,
    inboundSettings,
    outboundSettings,
    launchNotifications,
    channelSupport,
    callFlowText,
    generatedPrompt,
    uploadedScriptNames,
  }
}

function buildAgentMeta(input: z.infer<typeof agentPayloadSchema>) {
  return {
    type: 'AI Agent',
    description: input.description ?? '',
    status: 'active',
    useCase: input.useCase,
    gender: input.gender,
    speechPace: input.speechPace,
    personality: input.personality,
    languages: input.languages,
    channels: input.channels,
    inboundSettings: input.inboundSettings,
    outboundSettings: input.outboundSettings,
    launchNotifications: input.launchNotifications,
    channelSupport: CHANNEL_SUPPORT_DEFAULTS,
    callFlowText: input.callFlowText ?? '',
  }
}

function normalizeAgentChannels(channels: string[]) {
  const unique = [...new Set(channels.map((item) => item.trim()).filter(Boolean))]
  if (unique.includes('Call')) return ['Inbound Call', 'Outbound Call']
  return unique
}

function slugifyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function buildExternalRef(name: string) {
  const base = slugifyName(name) || 'agent'
  return `${base}_${crypto.randomUUID().slice(0, 8)}`
}

async function ensureClientBelongsToAdmin(
  db: NonNullable<ReturnType<AppEnv['Variables']['db'] extends infer T ? () => T : never>>,
  adminId: string,
  clientId: string
) {
  const row = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.adminId, adminId), eq(clients.id, clientId))).limit(1)
  return !!row[0]
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      return [trimmed]
    }
  }
  return []
}

function normalizeJsonObject(value: unknown) {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function normalizeOptionalString(value: unknown) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

function normalizeUploadedFiles(value: unknown) {
  if (value instanceof File) return [value]
  if (Array.isArray(value)) return value.filter((item): item is File => item instanceof File)
  return []
}

function normalizeGeneratedPrompt(value: unknown) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    throw new Error('Generated call flow must be a JSON object')
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  throw new Error('Generated call flow must be a JSON object')
}

function formatExtractedScriptSource(extractedScripts: Array<{ fileName: string; text: string }>) {
  return extractedScripts
    .filter((item) => item.text.trim())
    .map((item) => `--- DOCUMENT: ${item.fileName} ---\n${item.text.trim()}`)
    .join('\n\n')
}

async function parseAgentRequest(c: Context<AppEnv>) {
  const contentType = c.req.header('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody({ all: true })
    return {
      payload: {
        name: body.name,
        description: body.description,
        callFlowText: body.callFlowText,
        generatedPrompt: body.generatedPrompt,
        uploadedScriptNames: normalizeStringArray(body.uploadedScriptNames),
        useCase: body.useCase,
        gender: body.gender,
        speechPace: body.speechPace,
        personality: body.personality,
        languages: normalizeStringArray(body.languages),
        channels: normalizeStringArray(body.channels),
        inboundSettings: normalizeJsonObject(body.inboundSettings),
        outboundSettings: normalizeJsonObject(body.outboundSettings),
        launchNotifications: normalizeJsonObject(body.launchNotifications),
        clientId: normalizeOptionalString(body.clientId),
      },
      scriptFiles: normalizeUploadedFiles(body.scriptFiles),
    }
  }

  const body = await c.req.json().catch(() => null)
  return {
    payload: body,
    scriptFiles: [] as File[],
  }
}

async function parseCallFlowRequest(c: Context<AppEnv>) {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody({ all: true })
    return {
      callFlowText: normalizeOptionalString(body.callFlowText ?? body.text ?? body.description) ?? '',
      scriptFiles: normalizeUploadedFiles(body.scriptFiles),
    }
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  return {
    callFlowText: normalizeOptionalString(body?.callFlowText ?? body?.text ?? body?.description) ?? '',
    scriptFiles: [] as File[],
  }
}

async function extractPromptScripts(env: AppEnv['Bindings'], scriptFiles: File[]) {
  const extractedScripts: Array<{ fileName: string; text: string }> = []
  for (const file of scriptFiles) {
    const text = await extractTextFromPromptFile(env, file)
    if (text.trim()) extractedScripts.push({ fileName: file.name, text })
  }
  return extractedScripts
}

function toAgentResponse(bot: typeof bots.$inferSelect) {
  const meta = normalizeAgentMeta(parseAgentMeta(bot.metaJson), '')

  return {
    agent_id: bot.externalRef,
    name: bot.name,
    type: meta.type,
    description: meta.description,
    status: meta.status,
    useCase: meta.useCase,
    gender: meta.gender,
    speechPace: meta.speechPace,
    personality: meta.personality,
    languages: meta.languages,
    channels: meta.channels,
    inboundSettings: meta.inboundSettings,
    outboundSettings: meta.outboundSettings,
    launchNotifications: meta.launchNotifications,
    channelSupport: meta.channelSupport,
    callFlowText: meta.callFlowText,
    generatedPrompt: meta.generatedPrompt,
    uploadedScriptNames: meta.uploadedScriptNames,
    clientId: bot.clientId ?? null,
  }
}

async function writeAgentActivityLog(
  db: AppEnv['Variables']['db'],
  input: {
    adminId: string
    clientId: string | null
    userId: string
    botId: string | null
    action: 'created' | 'updated' | 'deleted'
    agentName: string
  }
) {
  await db!.insert(agentActivityLogs).values({
    id: crypto.randomUUID(),
    adminId: input.adminId,
    clientId: input.clientId,
    userId: input.userId,
    botId: input.botId,
    action: input.action,
    title:
      input.action === 'created'
        ? 'Agent created'
        : input.action === 'updated'
          ? 'Agent updated'
          : 'Agent deleted',
    message:
      input.action === 'created'
        ? `${input.agentName} was created successfully.`
        : input.action === 'updated'
          ? `${input.agentName} was updated successfully.`
          : `${input.agentName} was deleted successfully.`,
    createdAt: new Date(),
  })
}

export const agentsRoutes = new Hono<AppEnv>()
  .use('*', authMiddleware)
  .get('/', async (c) => {
    const user = c.get('user')!
    if (!canViewAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const db = c.get('db')!
    const condition =
      user.role === 'client' && user.clientId
        ? and(eq(bots.adminId, user.adminId), or(isNull(bots.clientId), eq(bots.clientId, user.clientId)))
        : eq(bots.adminId, user.adminId)

    const rows = await db.select().from(bots).where(condition)
    return c.json({ success: true, data: rows.map(toAgentResponse) })
  })
  .post('/generate-call-flow', async (c) => {
    const user = c.get('user')!
    if (!canManageAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const requestData = await parseCallFlowRequest(c)
    if (!requestData.callFlowText && requestData.scriptFiles.length === 0) {
      return c.json({ success: false, error: 'Provide call flow text or upload at least one script file' }, 400)
    }

    let extractedScripts: Array<{ fileName: string; text: string }> = []
    try {
      extractedScripts = await extractPromptScripts(c.env, requestData.scriptFiles)
    } catch (error) {
      return promptServiceFailure(
        c,
        'We could not read the uploaded script file right now. Please try again, use a plain text file, or paste the call flow directly.',
        error,
        'PROMPT_EXTRACTION_FAILED',
      )
    }

    const extractedText = formatExtractedScriptSource(extractedScripts)
    const sourceText = [requestData.callFlowText, extractedText].filter((item) => item.trim()).join('\n\n')
    if (!sourceText.trim()) {
      return c.json({ success: false, error: 'No readable call flow content was found' }, 400)
    }

    try {
      const generatedPrompt = await generatePromptFromText(c.env, sourceText)
      return c.json({
        success: true,
        data: {
          generatedPrompt,
          callFlowText: sourceText,
          uploadedScriptNames: extractedScripts.map((item) => item.fileName),
        },
      })
    } catch (error) {
      return promptServiceFailure(
        c,
        'Call flow generation is temporarily unavailable. Please try again in a few minutes.',
        error,
        'PROMPT_GENERATION_FAILED',
      )
    }
  })
  .post('/analyze-scripts', async (c) => {
    const user = c.get('user')!
    if (!canManageAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const body = await c.req.parseBody({ all: true })
    const scriptFiles = normalizeUploadedFiles(body.scriptFiles)

    if (scriptFiles.length === 0) {
      return c.json({ success: false, error: 'No script files provided' }, 400)
    }

    let extractedScripts: Array<{ fileName: string; text: string }> = []
    try {
      extractedScripts = await extractPromptScripts(c.env, scriptFiles)
    } catch (error) {
      return promptServiceFailure(
        c,
        'We could not read the uploaded script file right now. Please try again, use a plain text file, or paste the script directly.',
        error,
        'PROMPT_EXTRACTION_FAILED',
      )
    }

    try {
      const generatedPrompt = await generateAgentPrompt(c.env, {
        name: 'Draft Agent',
        useCase: 'Custom',
        gender: 'Neutral',
        personality: 'Custom',
        description: '',
        languages: ['English'],
        channels: ['Outbound Call'],
        extractedScripts,
      })

      return c.json({
        success: true,
        data: {
          generatedPrompt,
        },
      })
    } catch (error) {
      return promptServiceFailure(
        c,
        'Script analysis is temporarily unavailable. Please try again in a few minutes.',
        error,
        'PROMPT_GENERATION_FAILED',
      )
    }
  })
  .post('/', async (c) => {
    const user = c.get('user')!
    if (!canManageAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const requestData = await parseAgentRequest(c)
    const parsed = agentPayloadSchema.safeParse(requestData.payload)
    if (!parsed.success) {
      return c.json({ success: false, error: 'Invalid agent payload' }, 400)
    }

    const db = c.get('db')!
    const clientId = parsed.data.clientId ?? null
    if (clientId && !(await ensureClientBelongsToAdmin(db as never, user.adminId, clientId))) {
      return c.json({ success: false, error: 'Invalid client' }, 400)
    }
    const selectedChannels = normalizeAgentChannels(parsed.data.channels)
    let providedGeneratedPrompt: Record<string, unknown> | null
    try {
      providedGeneratedPrompt = normalizeGeneratedPrompt(parsed.data.generatedPrompt)
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : 'Invalid generated call flow' }, 400)
    }
    const clientName =
      clientId
        ? (
            await db.select({ name: clients.name }).from(clients).where(and(eq(clients.adminId, user.adminId), eq(clients.id, clientId))).limit(1)
          )[0]?.name ?? null
        : null

    let extractedScripts: Array<{ fileName: string; text: string }> = []
    let generatedPrompt = providedGeneratedPrompt
    if (!generatedPrompt) {
      if (!parsed.data.callFlowText && requestData.scriptFiles.length === 0) {
        return c.json({ success: false, error: 'Generate or provide a call flow before saving the agent' }, 400)
      }

      try {
        extractedScripts = await extractPromptScripts(c.env, requestData.scriptFiles)
      } catch (error) {
        return promptServiceFailure(
          c,
          'We could not read the uploaded script file right now. Please try again, use a plain text file, or paste the call flow directly.',
          error,
          'PROMPT_EXTRACTION_FAILED',
        )
      }

      try {
        generatedPrompt = await generateAgentPrompt(c.env, {
          name: parsed.data.name,
          useCase: parsed.data.useCase,
          gender: parsed.data.gender,
          personality: parsed.data.personality,
          description: parsed.data.callFlowText ?? '',
          languages: parsed.data.languages,
          channels: selectedChannels,
          clientName,
          extractedScripts,
        })
      } catch (error) {
        return promptServiceFailure(
          c,
          'Call flow generation is temporarily unavailable. Please submit the call flow again before saving.',
          error,
          'PROMPT_GENERATION_FAILED',
        )
      }
    }

    if (generatedPrompt) {
      generatedPrompt = injectLanguagesIntoPrompt(generatedPrompt as Record<string, unknown>, parsed.data.languages)
    }

    const now = new Date()
    const uploadedScriptNames = parsed.data.uploadedScriptNames.length
      ? parsed.data.uploadedScriptNames
      : extractedScripts.map((item) => item.fileName)
    const bot = {
      id: crypto.randomUUID(),
      adminId: user.adminId,
      clientId,
      name: parsed.data.name,
      externalRef: buildExternalRef(parsed.data.name),
      metaJson: JSON.stringify({
        ...buildAgentMeta({ ...parsed.data, channels: selectedChannels }),
        generatedPrompt,
        uploadedScriptNames,
      }),
      dashboardAnalyticsQuery: null,
      dashboardLogsQuery: null,
      campaignListQuery: null,
      createdAt: now,
    }

    await db.insert(bots).values(bot)
    await writeAgentActivityLog(db, {
      adminId: user.adminId,
      clientId,
      userId: user.sub,
      botId: bot.id,
      action: 'created',
      agentName: bot.name,
    })
    return c.json({ success: true, data: toAgentResponse(bot) })
  })
  .put('/:agentId', async (c) => {
    const user = c.get('user')!
    if (!canManageAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const requestData = await parseAgentRequest(c)
    const parsed = agentPayloadSchema.safeParse(requestData.payload)
    if (!parsed.success) {
      return c.json({ success: false, error: 'Invalid agent payload' }, 400)
    }

    const db = c.get('db')!
    const agentId = c.req.param('agentId')
    const existing = await db
      .select()
      .from(bots)
      .where(and(eq(bots.adminId, user.adminId), eq(bots.externalRef, agentId)))
      .limit(1)

    const bot = existing[0]
    if (!bot) {
      return c.json({ success: false, error: 'Agent not found' }, 404)
    }

    const clientId = parsed.data.clientId ?? null
    if (clientId && !(await ensureClientBelongsToAdmin(db as never, user.adminId, clientId))) {
      return c.json({ success: false, error: 'Invalid client' }, 400)
    }
    const selectedChannels = normalizeAgentChannels(parsed.data.channels)
    let providedGeneratedPrompt: Record<string, unknown> | null
    try {
      providedGeneratedPrompt = normalizeGeneratedPrompt(parsed.data.generatedPrompt)
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : 'Invalid generated call flow' }, 400)
    }
    const clientName =
      clientId
        ? (
            await db.select({ name: clients.name }).from(clients).where(and(eq(clients.adminId, user.adminId), eq(clients.id, clientId))).limit(1)
          )[0]?.name ?? null
        : null
    const existingMeta = parseAgentMeta(bot.metaJson)
    let extractedScripts: Array<{ fileName: string; text: string }> = []
    let generatedPrompt = providedGeneratedPrompt
    if (!generatedPrompt) {
      try {
        generatedPrompt = normalizeGeneratedPrompt(existingMeta.generatedPrompt)
      } catch {
        generatedPrompt = null
      }
    }

    if (!generatedPrompt) {
      if (!parsed.data.callFlowText && requestData.scriptFiles.length === 0) {
        return c.json({ success: false, error: 'Generate or provide a call flow before saving the agent' }, 400)
      }

      try {
        extractedScripts = await extractPromptScripts(c.env, requestData.scriptFiles)
      } catch (error) {
        return promptServiceFailure(
          c,
          'We could not read the uploaded script file right now. Please try again, use a plain text file, or paste the call flow directly.',
          error,
          'PROMPT_EXTRACTION_FAILED',
        )
      }

      try {
        generatedPrompt = await generateAgentPrompt(c.env, {
          name: parsed.data.name,
          useCase: parsed.data.useCase,
          gender: parsed.data.gender,
          personality: parsed.data.personality,
          description: parsed.data.callFlowText ?? '',
          languages: parsed.data.languages,
          channels: selectedChannels,
          clientName,
          extractedScripts,
        })
      } catch (error) {
        return promptServiceFailure(
          c,
          'Call flow generation is temporarily unavailable. Please submit the call flow again before saving.',
          error,
          'PROMPT_GENERATION_FAILED',
        )
      }
    }

    const uploadedScriptNames = parsed.data.uploadedScriptNames.length
      ? parsed.data.uploadedScriptNames
      : extractedScripts.length
        ? extractedScripts.map((item) => item.fileName)
        : Array.isArray(existingMeta.uploadedScriptNames)
          ? existingMeta.uploadedScriptNames
          : []

    if (generatedPrompt) {
      generatedPrompt = injectLanguagesIntoPrompt(generatedPrompt as Record<string, unknown>, parsed.data.languages)
    }

    const nextMetaJson = JSON.stringify({
      ...buildAgentMeta({ ...parsed.data, channels: selectedChannels }),
      generatedPrompt,
      uploadedScriptNames,
    })

    await db
      .update(bots)
      .set({
        name: parsed.data.name,
        clientId,
        metaJson: nextMetaJson,
      })
      .where(eq(bots.id, bot.id))

    await writeAgentActivityLog(db, {
      adminId: user.adminId,
      clientId,
      userId: user.sub,
      botId: bot.id,
      action: 'updated',
      agentName: parsed.data.name,
    })

    return c.json({
      success: true,
      data: toAgentResponse({
        ...bot,
        name: parsed.data.name,
        clientId,
        metaJson: nextMetaJson,
      }),
    })
  })
  .delete('/:agentId', async (c) => {
    const user = c.get('user')!
    if (!canManageAgents(user.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    const db = c.get('db')!
    const agentId = c.req.param('agentId')
    const existing = await db
      .select()
      .from(bots)
      .where(and(eq(bots.adminId, user.adminId), eq(bots.externalRef, agentId)))
      .limit(1)

    const bot = existing[0]
    if (!bot) {
      return c.json({ success: false, error: 'Agent not found' }, 404)
    }

    const linkedCampaigns = await db
      .select({ count: count() })
      .from(campaigns)
      .where(and(eq(campaigns.adminId, user.adminId), eq(campaigns.botId, bot.id)))

    if (Number(linkedCampaigns[0]?.count ?? 0) > 0) {
      return c.json(
        {
          success: false,
          error: 'This agent is already used in one or more campaigns and cannot be deleted.',
        },
        400,
      )
    }

    await db.delete(bots).where(eq(bots.id, bot.id))
    await writeAgentActivityLog(db, {
      adminId: user.adminId,
      clientId: bot.clientId ?? null,
      userId: user.sub,
      botId: null,
      action: 'deleted',
      agentName: bot.name,
    })

    return c.json({ success: true, data: { agent_id: bot.externalRef } })
  })
