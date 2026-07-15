import { SignJWT, jwtVerify } from 'jose'
import { isUserRole, type UserRole, type UserStatus } from './roles'

export type AuthTokenPayload = {
  sub: string
  adminId: string
  adminSlug: string
  email: string
  role: UserRole
  clientId: string | null
}

export type AuthPayload = AuthTokenPayload & {
  name: string
  status: UserStatus
  mustChangePassword: boolean
  lastLoginAt: Date | null
}

export async function signAuth(secret: string, p: AuthTokenPayload, ttl = '7d'): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const claims: Record<string, unknown> = {
    adminId: p.adminId,
    adminSlug: p.adminSlug,
    email: p.email,
    role: p.role,
  }
  if (p.role === 'client' && p.clientId) claims.clientId = p.clientId
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key)
}

export async function verifyAuth(secret: string, token: string): Promise<AuthTokenPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    const sub = typeof payload.sub === 'string' ? payload.sub : ''
    const adminId = typeof payload.adminId === 'string' ? payload.adminId : ''
    const adminSlug = typeof payload.adminSlug === 'string' ? payload.adminSlug : ''
    const email = typeof payload.email === 'string' ? payload.email : ''
    const role = isUserRole(payload.role) ? payload.role : null
    const clientId = typeof payload.clientId === 'string' ? payload.clientId : null
    if (!sub || !adminId || !adminSlug || !email || !role) return null
    if (role === 'client' && !clientId) return null
    return { sub, adminId, adminSlug, email, role, clientId: role === 'client' ? clientId : null }
  } catch {
    return null
  }
}
