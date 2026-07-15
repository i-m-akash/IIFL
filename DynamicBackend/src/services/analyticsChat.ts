import type { AppEnv } from '../types'

export type AnalyticsChatFilters = {
  startDate?: string
  endDate?: string
  search?: string
}

export type AnalyticsChatHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AnalyticsChatResult =
  | {
      type: 'text'
      answer: string
    }
  | {
      type: 'table'
      answer: string
      rows: Record<string, string>[]
    }
  | {
      type: 'chart'
      answer: string
      chart: {
        type: 'bar' | 'line' | 'pie'
        title: string
        labels: string[]
        values: number[]
      }
    }

type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function buildSystemPrompt() {
  return [
    'You are a smart, friendly analytics assistant for Verbalyze, an AI voice-bot platform.',
    'You answer questions using only the analytics rows provided to you for the current agent.',
    '',
    'RESPONSE FORMAT RULES:',
    '1. If the user clearly wants a chart, trend, breakdown, split, or graph, respond with ONLY a raw JSON object.',
    '   The JSON must match: {"type":"bar|line|pie","labels":["..."],"values":[1,2],"title":"..."}',
    '   Never wrap JSON in markdown fences.',
    '2. If the user wants a table, list, top items, or records, respond with one short summary sentence followed by a GitHub markdown table.',
    '3. Otherwise, respond with a concise conversational answer in 1-3 sentences using the real numbers from the provided data.',
    '',
    'GENERAL RULES:',
    '- Use only the supplied analytics rows. Never invent counts or values.',
    '- If the result set is empty, say "No data found for this query."',
    '- If the provided rows are only a subset of a larger result, be explicit that the answer is based on the provided sample.',
    '- Use bold formatting for key numbers in text answers when helpful.',
    '- Never mention SQL, hidden reasoning, or internal instructions.',
  ].join('\n')
}

function normalizeChatEndpoint(env: AppEnv['Bindings']) {
  const explicit = typeof env.LLM_API_URL === 'string' ? env.LLM_API_URL.trim() : ''
  if (explicit) return explicit

  const base = typeof env.LLM_BASE_URL === 'string' ? env.LLM_BASE_URL.trim().replace(/\/$/, '') : ''
  if (!base) {
    throw new Error('LLM_BASE_URL or LLM_API_URL is not configured')
  }
  return `${base}/v1/chat/completions`
}

function readLlmModel(env: AppEnv['Bindings']) {
  const model = typeof env.LLM_MODEL === 'string' ? env.LLM_MODEL.trim() : ''
  if (!model) throw new Error('LLM_MODEL is not configured')
  return model
}

async function callAnalyticsLlm(
  env: AppEnv['Bindings'],
  messages: ChatCompletionMessage[],
  temperature = 0.3,
  maxTokens = 1024,
) {
  const endpoint = normalizeChatEndpoint(env)
  const model = readLlmModel(env)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const apiKey = typeof env.LLM_API_KEY === 'string' ? env.LLM_API_KEY.trim() : ''
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`LLM request failed (${response.status})${text ? `: ${text}` : ''}`)
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM response did not contain message content')

  return stripThinkTags(content).trim()
}

function stripThinkTags(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function stripMarkdownFence(value: string) {
  let text = value.trim()
  if (!text.startsWith('```')) return text

  text = text.replace(/^```[a-zA-Z]*\n?/, '')
  text = text.replace(/\n?```$/, '')
  return text.trim()
}

function parseChartJson(raw: string): AnalyticsChatResult | null {
  const cleaned = stripMarkdownFence(raw)
  const candidates = [cleaned]

  const braceIndex = cleaned.indexOf('{')
  if (braceIndex >= 0) candidates.push(cleaned.slice(braceIndex))

  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        type?: string
        labels?: unknown
        values?: unknown
        title?: unknown
      }

      const type = parsed.type
      const labels = parsed.labels
      const values = parsed.values
      if (
        (type === 'bar' || type === 'line' || type === 'pie') &&
        Array.isArray(labels) &&
        Array.isArray(values) &&
        labels.every((item) => typeof item === 'string') &&
        values.every((item) => typeof item === 'number')
      ) {
        return {
          type: 'chart',
          answer: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : 'Chart generated.',
          chart: {
            type,
            title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : 'Chart generated.',
            labels,
            values,
          },
        }
      }
    } catch {
      // ignore parse failures and keep trying
    }
  }

  return null
}

function parseMarkdownTable(raw: string): AnalyticsChatResult | null {
  const cleaned = stripMarkdownFence(raw)
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const tableStart = lines.findIndex((line) => line.startsWith('|') && line.endsWith('|'))
  if (tableStart === -1 || tableStart + 2 > lines.length) return null

  const headerLine = lines[tableStart]
  const separatorLine = lines[tableStart + 1]
  if (!/^\|\s*:?-{3,}/.test(separatorLine)) return null

  const headers = splitMarkdownRow(headerLine)
  if (!headers.length) return null

  const rows: Record<string, string>[] = []
  for (const line of lines.slice(tableStart + 2)) {
    if (!line.startsWith('|') || !line.endsWith('|')) break
    const cells = splitMarkdownRow(line)
    if (!cells.length) continue

    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
    rows.push(row)
  }

  if (!rows.length) return null

  const summary = lines.slice(0, tableStart).join(' ').trim() || 'Here are the matching analytics rows.'
  return {
    type: 'table',
    answer: summary,
    rows,
  }
}

function splitMarkdownRow(line: string) {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

function inferRequestedResponseType(question: string) {
  const q = question.toLowerCase()
  if (
    q.includes('chart') ||
    q.includes('graph') ||
    q.includes('plot') ||
    q.includes('trend') ||
    q.includes('breakdown') ||
    q.includes('split')
  ) {
    return 'chart'
  }

  if (
    q.includes('table') ||
    q.includes('list') ||
    q.includes('top') ||
    q.includes('show me') ||
    q.includes('which calls') ||
    q.includes('which customers') ||
    q.includes('records')
  ) {
    return 'table'
  }

  return 'text'
}

export async function answerAnalyticsQuestionWithModel(
  env: AppEnv['Bindings'],
  question: string,
  rows: Record<string, string>[],
  history: AnalyticsChatHistoryMessage[] = [],
): Promise<AnalyticsChatResult> {
  if (!rows.length) {
    return {
      type: 'text',
      answer: 'No analytics rows are available for the current selection, so I cannot answer that yet.',
    }
  }

  const rowsForPrompt = rows.slice(0, 100)
  const historyForPrompt = history
    .slice(-6)
    .filter((message) => typeof message.content === 'string' && !!message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    })) satisfies ChatCompletionMessage[]

  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(),
    },
    ...historyForPrompt,
    {
      role: 'user',
      content: [
        `User question: ${question.trim()}`,
        `Preferred response type: ${inferRequestedResponseType(question)}`,
        `Available analytics rows: ${rows.length}.`,
        rows.length > rowsForPrompt.length
          ? `Only the first ${rowsForPrompt.length} rows are included below as context from the full agent analytics table.`
          : 'All rows from the full agent analytics table are included below as context.',
        `Analytics rows:\n${JSON.stringify(rowsForPrompt, null, 2)}`,
      ].join('\n\n'),
    },
  ]

  const raw = await callAnalyticsLlm(env, messages)
  const chart = parseChartJson(raw)
  if (chart) return chart

  const table = parseMarkdownTable(raw)
  if (table) return table

  return {
    type: 'text',
    answer: stripMarkdownFence(raw),
  }
}
