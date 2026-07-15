import type { AppEnv } from '../types'

type PromptGeneratorInput = {
  name: string
  useCase: string
  gender: string
  personality: string
  description: string
  languages: string[]
  channels: string[]
  clientName?: string | null
  extractedScripts?: Array<{ fileName: string; text: string }>
}

function buildPromptSourceText(input: PromptGeneratorInput) {
  const languageList = input.languages.join(', ')
  const channelList = input.channels.join(', ')
  const description = input.description.trim() || 'No additional description was provided.'
  const clientLine = input.clientName?.trim() ? `Client or brand context: ${input.clientName.trim()}.` : ''
  const extractedScripts =
    input.extractedScripts?.length
      ? input.extractedScripts
          .filter((item) => item.text.trim())
          .map((item) => `--- DOCUMENT: ${item.fileName} ---\n${item.text.trim()}`)
          .join('\n\n')
      : ''

  return [
    `Agent named ${input.name}.`,
    `Role or use case: ${input.useCase}.`,
    `Voice gender: ${input.gender}.`,
    `Personality: ${input.personality}.`,
    `Supported languages: ${languageList}.`,
    `Enabled call flows: ${channelList}.`,
    clientLine,
    `Agent description and behavior: ${description}`,
    extractedScripts ? `Conversation script documents:\n${extractedScripts}` : '',
    'Generate a voice-agent system prompt JSON for this agent.',
  ]
    .filter(Boolean)
    .join(' ')
}

function readPromptGeneratorBaseUrl(env: AppEnv['Bindings']): string | null {
  const raw = env.PROMPT_GENERATOR_URL
  if (typeof raw !== 'string' || !raw.trim()) {
    return null
  }
  return raw.replace(/\/$/, '')
}

export async function generateAgentPrompt(env: AppEnv['Bindings'], input: PromptGeneratorInput) {
  return generatePromptFromText(env, buildPromptSourceText(input))
}

export async function generatePromptFromText(env: AppEnv['Bindings'], text: string) {
  const baseUrl = readPromptGeneratorBaseUrl(env)
  if (!baseUrl) {
    return {
      system_prompt: {
        identity: {
          name: "Development Agent",
          role: "Customer Support",
          gender: "Neutral",
        },
        description: "Local development agent generated in fallback mode.",
        language_settings: {
          supported: ["English"],
        },
        call_flow: [
          {
            step: "greeting",
            instruction: "Greet the customer politely and ask how you can help them.",
          },
          {
            step: "handle_request",
            instruction: "Listen to the customer's request and provide a helpful response.",
          },
          {
            step: "closing",
            instruction: "Thank the customer for calling and end the call politely.",
          },
        ],
        source: text.slice(0, 1000),
      },
      development_placeholder: true,
    }
  }
  const response = await fetch(`${baseUrl}/api/generate-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Prompt generator returned ${response.status}${text ? `: ${text}` : ''}`)
  }

  const result = (await response.json()) as Record<string, unknown>
  return result
}

export async function extractTextFromPromptFile(env: AppEnv['Bindings'], file: File) {
  const baseUrl = readPromptGeneratorBaseUrl(env)
  if (!baseUrl) {
    return `[Mock Extracted Text from ${file.name}]\nThis is a mock text representation of the uploaded script file for development purposes, because PROMPT_GENERATOR_URL is not configured.`
  }
  const response = await fetch(`${baseUrl}/api/extract-text`, {
    method: 'POST',
    headers: {
      'X-File-Name': file.name,
      'Content-Type': 'application/octet-stream',
    },
    body: await file.arrayBuffer(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Prompt extraction failed for ${file.name}: ${response.status}${text ? `: ${text}` : ''}`)
  }

  const result = (await response.json()) as { text?: string; error?: string }
  if (result.error) throw new Error(result.error)
  return result.text?.trim() ?? ''
}
