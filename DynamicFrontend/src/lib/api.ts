/** API root: empty uses same-origin `/api` (Vite dev proxy → wrangler). */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  const base = raw && String(raw).trim() !== '' ? String(raw).replace(/\/$/, '') : ''
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

const TOKEN_KEY = 'portal_token'
export const AUTH_EXPIRED_EVENT = 'portal:auth-expired'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

type ApiErrorBody = {
  error?: unknown
  message?: unknown
  code?: unknown
}

export class ApiError extends Error {
  status?: number
  code?: string
  detail?: string
  correlationId?: string

  constructor(message: string, options: { status?: number; code?: string; detail?: string; correlationId?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.detail = options.detail
    this.correlationId = options.correlationId
  }
}

function fallbackForStatus(status?: number, fallback = 'Something went wrong. Please try again.') {
  if (!status) return fallback
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'We could not find that record. Please refresh and try again.'
  if (status === 408 || status === 429) return 'The service is busy right now. Please try again shortly.'
  if (status >= 500) return 'The service is temporarily unavailable. Please try again in a few minutes.'
  return fallback
}

function isTechnicalMessage(message: string) {
  return (
    /^HTTP\s+\d{3}$/i.test(message) ||
    /\bAPI returned\s+\d{3}\b/i.test(message) ||
    /\breturned\s+\d{3}\b/i.test(message) ||
    /error code:\s*\d+/i.test(message) ||
    /prompt generator returned/i.test(message) ||
    /\b(SQLITE|D1|Postgres|Hyperdrive|TypeError|ReferenceError|SyntaxError)\b/i.test(message) ||
    /\b(ECONN|ETIMEDOUT|ENOTFOUND|EPERM|fetch failed|certificate|self-signed)\b/i.test(message) ||
    message.length > 220
  )
}

export function toUserFriendlyMessage(message: unknown, fallback = 'Something went wrong. Please try again.', status?: number) {
  const raw = typeof message === 'string' ? message.trim() : ''
  const statusFallback = fallbackForStatus(status, fallback)
  if (!raw) return statusFallback
  if (status && status >= 500) return statusFallback
  if (isTechnicalMessage(raw)) return statusFallback
  return raw
}

export function getUserErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError) return error.message
  if (error instanceof DOMException && error.name === 'AbortError') return 'The request took too long. Please try again.'
  if (error instanceof TypeError) return 'Network connection failed. Please check your connection and try again.'
  if (error instanceof Error) return toUserFriendlyMessage(error.message, fallback)
  return fallback
}

export async function apiErrorFromResponse(response: Response, fallback = 'Something went wrong. Please try again.') {
  let body: any = null
  let detail = ''

  try {
    body = (await response.clone().json()) as any
  } catch {
    detail = await response.clone().text().catch(() => '')
  }

  const rawMessage = body?.error ?? body?.message ?? detail
  const message = toUserFriendlyMessage(rawMessage, fallback, response.status)
  const code = typeof body?.code === 'string' ? body.code : undefined
  const correlationId = typeof body?.correlationId === 'string' ? body.correlationId : undefined

  return new ApiError(message, {
    status: response.status,
    code,
    detail: typeof rawMessage === 'string' ? rawMessage : undefined,
    correlationId,
  })
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(input)
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })

  if (token && response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }

  return response
}

export async function apiFetchWithRetry(
  input: string,
  init?: RequestInit,
  retries = 3,
  initialDelayMs = 1000,
  backoffFactor = 2,
): Promise<Response> {
  let currentAttempt = 0
  let delay = initialDelayMs

  while (true) {
    try {
      currentAttempt++
      const response = await apiFetch(input, init)

      const isTransient = [502, 503, 504].includes(response.status)
      if (isTransient && currentAttempt < retries) {
        console.warn(`[apiFetchWithRetry] Attempt ${currentAttempt} failed with status ${response.status}. Retrying in ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= backoffFactor
        continue
      }
      return response
    } catch (error) {
      if (currentAttempt < retries) {
        console.warn(`[apiFetchWithRetry] Attempt ${currentAttempt} failed due to network error. Retrying in ${delay}ms...`, error)
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= backoffFactor
        continue
      }
      throw error
    }
  }
}
