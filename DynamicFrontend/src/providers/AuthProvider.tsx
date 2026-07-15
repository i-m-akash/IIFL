import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AUTH_EXPIRED_EVENT, apiFetch, apiUrl, getToken, setToken, toUserFriendlyMessage } from '../lib/api'
import { isUserRole, isUserStatus, type UserRole, type UserStatus } from '@/lib/roles'

const USER_KEY = 'portal_user'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
  status: UserStatus
  mustChangePassword: boolean
  adminSlug: string
  adminName?: string
  adminLogoUrl?: string | null
  clientId: string | null
  lastLoginAt: string | null
}

type AuthContextValue = {
  user: AuthUser | null
  isAuthenticated: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<{ success: true; user: AuthUser } | { success: false; error?: string }>
  refreshUser: () => Promise<AuthUser | null>
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: true; user: AuthUser } | { success: false; error?: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

type AuthApiResponse = {
  success?: boolean
  token?: string
  user?: AuthUser
  error?: string
}

function persistUser(nextUser: AuthUser | null) {
  if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
  else localStorage.removeItem(USER_KEY)
}

function clearStoredAuth() {
  persistUser(null)
  setToken(null)
}

function normalizeStoredUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const adminSlug = typeof o.adminSlug === 'string' ? o.adminSlug : ''
  if (!adminSlug || typeof o.email !== 'string' || typeof o.id !== 'string') return null
  const role = isUserRole(o.role) ? o.role : 'admin'
  const status = isUserStatus(o.status) ? o.status : 'active'

  return {
    id: o.id as string,
    email: o.email as string,
    name: typeof o.name === 'string' && o.name.trim() ? o.name : String(o.email).split('@')[0],
    role,
    status,
    mustChangePassword: typeof o.mustChangePassword === 'boolean' ? o.mustChangePassword : false,
    adminSlug,
    adminName: typeof o.adminName === 'string' ? o.adminName : undefined,
    adminLogoUrl: typeof o.adminLogoUrl === 'string' ? o.adminLogoUrl : null,
    clientId: (o.clientId as string | null) ?? null,
    lastLoginAt: typeof o.lastLoginAt === 'string' ? o.lastLoginAt : null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const logout = useCallback(() => {
    clearStoredAuth()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const token = getToken()
    if (!token) {
      logout()
      return null
    }

    try {
      const res = await fetch(apiUrl('/api/auth/me'), {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) logout()
        return null
      }

      const data = (await res.json()) as { success?: boolean; user?: AuthUser }
      if (!data.success || !data.user) return null

      persistUser(data.user)
      setUser(data.user)
      return data.user
    } catch {
      return null
    }
  }, [logout])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const raw = localStorage.getItem(USER_KEY)
      if (raw) {
        try {
          const parsed = normalizeStoredUser(JSON.parse(raw))
          if (parsed && !cancelled) setUser(parsed)
          else clearStoredAuth()
        } catch {
          clearStoredAuth()
        }
      }

      if (getToken()) {
        await refreshUser()
      }

      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [refreshUser])

  useEffect(() => {
    const handleExpired = () => logout()
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      let data: AuthApiResponse
      try {
        data = await res.json()
      } catch {
        return { success: false as const, error: `Bad API response (${res.status}). Start wrangler on :8787.` }
      }
      if (!res.ok) {
        return { success: false as const, error: toUserFriendlyMessage(data.error, 'Unable to sign in. Please try again.', res.status) }
      }
      if (data.success && data.token && data.user) {
        setToken(data.token)
        persistUser(data.user)
        setUser(data.user)
        return { success: true as const, user: data.user }
      }
      return { success: false as const, error: data.error || 'Invalid email or password' }
    } catch {
      return { success: false as const, error: 'Network error (API down or wrong URL).' }
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = (await res.json()) as AuthApiResponse

      if (!res.ok || !data.success || !data.user) {
        return { success: false as const, error: toUserFriendlyMessage(data.error, 'Unable to update password', res.status) }
      }

      persistUser(data.user)
      setUser(data.user)
      return { success: true as const, user: data.user }
    } catch {
      return { success: false as const, error: 'Network error (API down or wrong URL).' }
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      loading,
      login,
      refreshUser,
      changePassword,
      logout,
    }),
    [user, loading, login, refreshUser, changePassword, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
